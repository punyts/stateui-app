import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { isObject } from '../resolve/merge.js';
import type { JsonObject, JsonValue } from '../types.js';
import { captureNames, compilePattern, fillCaptures, isStatePath } from './pattern.js';
import { LOGIC_COMMAND_KEYS, LOGIC_COMMANDS } from './types.js';
import type { LogicCommand, LogicDocument, LogicMachine, LogicRule, LogicTransition, LogicTrigger } from './types.js';
import { LogicError, compileExpression, templateExpressions } from './values.js';

/** The roots logic may watch and write; `$.server` is refused outside Full mode by the document check */
const LOGIC_ROOTS = ['app', 'data', 'server'];

const MACHINE_KEYS = ['state', 'initial', 'transitions'];
const TRANSITION_KEYS = ['from', 'when', 'do', 'to'];
const RULE_KEYS = ['when', 'do'];
const TRIGGER_KEYS = ['path', 'result', 'is', 'if'];

/** The keys each command needs */
const REQUIRED: Record<LogicCommand['command'], readonly ('target' | 'from' | 'into' | 'value')[]> = {
    set: ['target'],
    merge: ['target', 'value'],
    copy: ['from', 'target'],
    toggle: ['target'],
    increment: ['target'],
    reset: ['target'],
    'save-data': ['into', 'value'],
    'delete-data': ['target'],
    'pull-data': ['from', 'target'],
    query: ['from', 'into'],
    notify: ['target'],
    emit: ['target'],
    reject: []
};

/** The keys whose text is a path */
const PATH_KEYS = ['target', 'from', 'into'] as const;

export interface ReadLogicOptions {
    /** Resolves a node reference (`^name.path`) to a state path; without it references are not checked */
    resolve?(reference: string): string | undefined;
}

export interface ReadLogicResult {
    /** The machines and rules that have no errors */
    logic: LogicDocument;
    errors: BuildError[];
}

class Reader {
    readonly errors: BuildError[] = [];

    constructor(private readonly options: ReadLogicOptions) {}

    shape(path: string, name: string): void {
        this.errors.push(buildError('SUI-LOGIC-SHAPE', { path, name, statePath: path }));
    }

    unknownKeys(value: JsonObject, allowed: readonly string[], path: string): void {
        for (const key of Object.keys(value)) if (!allowed.includes(key)) this.shape(`${path}.${key}`, `unknown key "${key}"`);
    }

    expression(text: string, path: string): void {
        try {
            compileExpression(text);
        } catch (error) {
            this.errors.push(buildError('SUI-LOGIC-EXPRESSION', { path, name: (error as LogicError).message, statePath: path }));
        }
    }

    /** Every `{{ … }}` of a value compiles */
    templates(value: JsonValue | undefined, path: string): void {
        if (typeof value === 'string') {
            for (const text of templateExpressions(value)) this.expression(text, path);
        } else if (Array.isArray(value)) {
            value.forEach((item, index) => this.templates(item, `${path}.${index}`));
        } else if (isObject(value)) {
            for (const [key, item] of Object.entries(value)) this.templates(item, `${path}.${key}`);
        }
    }

    /** A path of a trigger, a machine state or a command: under `$.app`, `$.data` or `$.server`, or a node reference that resolves */
    statePath(text: string, path: string, captures: readonly string[]): void {
        const bad = (): void => {
            this.errors.push(buildError('SUI-LOGIC-PATH', { target: text, path, statePath: path }));
        };
        if (text.startsWith('^')) {
            if (this.options.resolve && !text.includes('{') && this.options.resolve(text) === undefined) bad();
            return;
        }
        const filled = fillCaptures(text, Object.fromEntries(captures.map((name) => [name, name])));
        const plain = filled.split('{{')[0] as string;
        const steps = plain.startsWith('$.') ? plain.slice(2).split('.') : [];
        if (!LOGIC_ROOTS.includes(steps[0] ?? '') || /\{[A-Za-z_]/.test(filled.replace(/\{\{[\s\S]*?\}\}/g, ''))) {
            bad();
            return;
        }
        if (!filled.includes('{{') && !isStatePath(filled)) bad();
        this.templates(text, path);
    }

    trigger(value: JsonValue | undefined, path: string, results: readonly string[] | undefined): { trigger?: LogicTrigger; captures: string[] } {
        if (!isObject(value)) {
            this.shape(path, '"when" must be an object');
            return { captures: [] };
        }
        this.unknownKeys(value, TRIGGER_KEYS, path);
        const before = this.errors.length;
        const trigger: LogicTrigger = {};
        let captures: string[] = [];
        const hasPath = Object.hasOwn(value, 'path');
        const hasResult = Object.hasOwn(value, 'result');
        if (hasPath === hasResult) this.shape(path, '"when" needs exactly one of "path" and "result"');
        if (hasPath) {
            const text = value['path'];
            const pattern = typeof text === 'string' ? compilePattern(text) : undefined;
            const root = pattern?.steps[0];
            if (!pattern || root?.kind !== 'literal' || !LOGIC_ROOTS.includes(root.text)) {
                this.errors.push(buildError('SUI-LOGIC-PATH', { target: String(text), path: `${path}.path`, statePath: `${path}.path` }));
            } else {
                trigger.path = pattern.source;
                captures = captureNames(pattern);
            }
        }
        if (hasResult) {
            const name = value['result'];
            if (results === undefined) this.shape(`${path}.result`, 'only a machine transition can wait for a result');
            else if (typeof name !== 'string' || !results.includes(name)) this.shape(`${path}.result`, `no command of the machine is named "${String(name)}"`);
            else trigger.result = name;
        }
        if (Object.hasOwn(value, 'is')) trigger.is = value['is'] as JsonValue;
        if (Object.hasOwn(value, 'if')) {
            const text = value['if'];
            if (typeof text !== 'string' || text.trim() === '') {
                this.shape(`${path}.if`, '"if" must be an expression');
            } else {
                const whole = /^\{\{([\s\S]+)\}\}$/.exec(text.trim());
                this.expression(whole ? (whole[1] as string).trim() : text, `${path}.if`);
                trigger.if = text;
            }
        }
        return this.errors.length === before ? { trigger, captures } : { captures };
    }

    command(value: JsonValue, path: string, captures: readonly string[], guard: boolean): LogicCommand | undefined {
        if (!isObject(value)) {
            this.shape(path, 'a command must be an object');
            return undefined;
        }
        const before = this.errors.length;
        this.unknownKeys(value, LOGIC_COMMAND_KEYS, path);
        const name = value['command'];
        if (typeof name !== 'string' || !(LOGIC_COMMANDS as readonly string[]).includes(name)) {
            this.errors.push(buildError('SUI-LOGIC-COMMAND', { command: String(name), path, statePath: path }));
            return undefined;
        }
        const command = name as LogicCommand['command'];
        if (command === 'reject' && !guard) this.shape(path, '"reject" must be the only command of a rule');
        for (const key of REQUIRED[command]) {
            if (!Object.hasOwn(value, key)) this.shape(path, `"${command}" needs "${key}"`);
        }
        for (const key of PATH_KEYS) {
            if (!Object.hasOwn(value, key)) continue;
            const text = value[key];
            if (typeof text !== 'string' || text === '') {
                this.shape(`${path}.${key}`, `"${key}" must be a path`);
            } else if (!((command === 'notify' || command === 'emit') && key === 'target')) {
                this.statePath(text, `${path}.${key}`, captures);
            }
        }
        for (const key of ['as', 'reason', 'key', 'filter'] as const) {
            if (Object.hasOwn(value, key) && (typeof value[key] !== 'string' || value[key] === '')) this.shape(`${path}.${key}`, `"${key}" must be a non-empty string`);
        }
        if (typeof value['filter'] === 'string') this.expression(value['filter'], `${path}.filter`);
        for (const key of ['value', 'key', 'reason', 'sort', 'window'] as const) {
            if (Object.hasOwn(value, key)) this.templates(value[key], `${path}.${key}`);
        }
        return this.errors.length === before ? (value as unknown as LogicCommand) : undefined;
    }

    commands(value: JsonValue | undefined, path: string, captures: readonly string[], options: { required: boolean; guard: boolean }): LogicCommand[] | undefined {
        if (value === undefined && !options.required) return [];
        if (!Array.isArray(value) || (options.required && value.length === 0)) {
            this.shape(path, '"do" must be a list of commands');
            return undefined;
        }
        const commands = value.map((item, index) => this.command(item, `${path}.${index}`, captures, options.guard));
        return commands.every((command) => command !== undefined) ? (commands as LogicCommand[]) : undefined;
    }

    machine(value: JsonValue, path: string): LogicMachine | undefined {
        if (!isObject(value)) {
            this.shape(path, 'a machine must be an object');
            return undefined;
        }
        const before = this.errors.length;
        this.unknownKeys(value, MACHINE_KEYS, path);
        const { state, initial, transitions } = value;
        if (typeof state !== 'string' || !isStatePath(state)) this.errors.push(buildError('SUI-LOGIC-PATH', { target: String(state), path: `${path}.state`, statePath: `${path}.state` }));
        else this.statePath(state, `${path}.state`, []);
        if (typeof initial !== 'string' || initial === '') this.shape(`${path}.initial`, '"initial" must be a state name');
        if (!Array.isArray(transitions) || transitions.length === 0) {
            this.shape(`${path}.transitions`, '"transitions" must be a non-empty list');
            return undefined;
        }

        const states = new Set<string>([String(initial)]);
        const results: string[] = [];
        for (const transition of transitions) {
            if (!isObject(transition)) continue;
            if (typeof transition['to'] === 'string') states.add(transition['to']);
            if (Array.isArray(transition['do'])) {
                for (const command of transition['do']) if (isObject(command) && typeof command['as'] === 'string') results.push(command['as']);
            }
        }

        const read: LogicTransition[] = [];
        transitions.forEach((item, index) => {
            const at = `${path}.transitions.${index}`;
            if (!isObject(item)) {
                this.shape(at, 'a transition must be an object');
                return;
            }
            this.unknownKeys(item, TRANSITION_KEYS, at);
            const { trigger, captures } = this.trigger(item['when'], `${at}.when`, results);
            const commands = this.commands(item['do'], `${at}.do`, captures, { required: false, guard: false });
            const transition: LogicTransition = { when: trigger ?? {}, do: commands ?? [] };
            for (const key of ['from', 'to'] as const) {
                if (!Object.hasOwn(item, key)) continue;
                const name = item[key];
                if (typeof name !== 'string' || name === '') this.shape(`${at}.${key}`, `"${key}" must be a state name`);
                else if (!states.has(name)) this.errors.push(buildError('SUI-LOGIC-STATE', { name, other: path.slice(path.lastIndexOf('.') + 1), path: `${at}.${key}`, statePath: `${at}.${key}` }));
                else transition[key] = name;
            }
            read.push(transition);
        });
        return this.errors.length === before ? { state: state as string, initial: initial as string, transitions: read } : undefined;
    }

    rule(value: JsonValue, path: string): LogicRule | undefined {
        if (!isObject(value)) {
            this.shape(path, 'a rule must be an object');
            return undefined;
        }
        const before = this.errors.length;
        this.unknownKeys(value, RULE_KEYS, path);
        const { trigger, captures } = this.trigger(value['when'], `${path}.when`, undefined);
        const list = value['do'];
        const guard = Array.isArray(list) && list.length === 1 && isObject(list[0]) && list[0]['command'] === 'reject';
        const commands = this.commands(list, `${path}.do`, captures, { required: true, guard });
        return this.errors.length === before && trigger && commands ? { when: trigger, do: commands } : undefined;
    }
}

/**
 * Reads the `logic` root of a document: the keyed maps `machines` and `rules`. Reports `SUI-LOGIC-SHAPE` (an unknown
 * key, a wrong type, a missing field), `SUI-LOGIC-COMMAND` (an unknown command), `SUI-LOGIC-PATH` (a path that is not
 * under `$.app`, `$.data` or `$.server`, a capture the trigger does not have, or a node reference that does not
 * resolve), `SUI-LOGIC-STATE` (a `from` or `to` that is neither the machine's `initial` nor the `to` of a transition)
 * and `SUI-LOGIC-EXPRESSION` (an expression that does not compile), each with its state path. The result keeps only
 * the machines and rules without errors, so an engine never runs a broken one
 */
export function readLogic(value: unknown, options: ReadLogicOptions = {}): ReadLogicResult {
    const reader = new Reader(options);
    const logic: LogicDocument = {};
    if (value === undefined) return { logic, errors: [] };
    if (!isObject(value as JsonValue)) {
        reader.shape('$.logic', '"logic" must be an object');
        return { logic, errors: reader.errors };
    }
    const root = value as JsonObject;
    reader.unknownKeys(root, ['machines', 'rules'], '$.logic');
    for (const key of ['machines', 'rules'] as const) {
        if (!Object.hasOwn(root, key)) continue;
        const map = root[key];
        if (!isObject(map)) {
            reader.shape(`$.logic.${key}`, `"${key}" must be a keyed map`);
            continue;
        }
        for (const [name, entry] of Object.entries(map)) {
            const path = `$.logic.${key}.${name}`;
            if (key === 'machines') {
                const machine = reader.machine(entry, path);
                if (machine) (logic.machines ??= {})[name] = machine;
            } else {
                const rule = reader.rule(entry, path);
                if (rule) (logic.rules ??= {})[name] = rule;
            }
        }
    }
    return { logic, errors: reader.errors };
}
