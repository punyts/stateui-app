import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { isObject } from '../resolve/merge.js';
import type { JsonObject, JsonValue } from '../types.js';
import { captureNames, compilePattern, fillCaptures, isStatePath } from './pattern.js';
import { LOGIC_COMMAND_KEYS, LOGIC_COMMANDS, MAX_DELAY } from './types.js';
import type { LogicCommand, LogicDocument, LogicMachine, LogicRow, LogicRule, LogicTable, LogicTransition, LogicTrigger } from './types.js';
import { LogicError, SCOPE_NAMES, compileExpression, templateExpressions, withCaptures } from './values.js';

/** The roots logic may watch and write; `$.server` is refused outside Full mode by the document check */
const LOGIC_ROOTS = ['app', 'data', 'server', 'screens', 'route'];

const MACHINE_KEYS = ['state', 'initial', 'transitions'];
const TRANSITION_KEYS = ['from', 'when', 'do', 'to'];
const RULE_KEYS = ['when', 'do'];
const TABLE_KEYS = ['when', 'inputs', 'rows'];
const ROW_KEYS = ['match', 'if', 'do'];
const TRIGGER_KEYS = ['path', 'result', 'is', 'was', 'if', 'after', 'debounce'];
const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Where a trigger is: a machine transition (with the result names of its machine and whether it has `from`), or a rule
 * or a table (with the result names of the rules and tables)
 */
interface TriggerPlace {
    results: readonly string[];
    machine?: boolean;
    from?: boolean;
}

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
    call: ['target'],
    reject: [],
    navigate: ['target']
};

/** The keys whose text is a path */
const PATH_KEYS = ['target', 'from', 'into'] as const;

export interface ReadLogicOptions {
    /** Resolves a node reference (`^name.path`) to a state path; without it references are not checked */
    resolve?(reference: string): string | undefined;
    /** Why a reference does not resolve (no node or several have its name), for the error */
    explain?(reference: string): string | undefined;
}

export interface ReadLogicResult {
    /** The machines and rules that have no errors */
    logic: LogicDocument;
    errors: BuildError[];
}

class Reader {
    readonly errors: BuildError[] = [];
    /** Warnings: they never drop a machine, rule or table */
    readonly warnings: BuildError[] = [];
    /** The captures of the trigger whose expressions are being read */
    private captures: readonly string[] = [];
    /** The `as` names of the commands of rules and tables, which a rule or table can wait for */
    sharedResults: readonly string[] = [];

    constructor(private readonly options: ReadLogicOptions) {}

    shape(path: string, name: string): void {
        this.errors.push(buildError('SUI-LOGIC-SHAPE', { path, name, statePath: path }));
    }

    unknownKeys(value: JsonObject, allowed: readonly string[], path: string): void {
        for (const key of Object.keys(value)) if (!allowed.includes(key)) this.shape(`${path}.${key}`, `unknown key "${key}"`);
    }

    expression(text: string, path: string): void {
        const filled = withCaptures(text, Object.fromEntries(this.captures.map((name) => [name, name])));
        const unknown = /\$\.[^\s'"()\[\],]*?\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(filled);
        if (unknown) {
            const known = this.captures.length === 0 ? 'the trigger captures nothing' : `its captures are ${this.captures.map((name) => `{${name}}`).join(', ')}`;
            this.errors.push(buildError('SUI-LOGIC-EXPRESSION', { path, name: `{${unknown[1] as string}} in a path is not a capture of this trigger (${known})`, statePath: path }));
            return;
        }
        try {
            compileExpression(filled);
        } catch (error) {
            this.errors.push(buildError('SUI-LOGIC-EXPRESSION', { path, name: (error as LogicError).message, statePath: path }));
        }
    }

    /** A value string that looks like a path with a template in it reads nothing: it is text */
    textPath(value: JsonValue | undefined, path: string): void {
        if (typeof value === 'string' && (value.startsWith('$.') || value.startsWith('^')) && value.includes('{{')) {
            this.warnings.push(buildError('SUI-LOGIC-TEXT-PATH', { target: value, path, statePath: path }));
        } else if (Array.isArray(value)) {
            value.forEach((item, index) => this.textPath(item, `${path}.${index}`));
        } else if (isObject(value) && !(Object.keys(value).length === 1 && ['record', 'form'].includes(Object.keys(value)[0] as string))) {
            for (const [key, item] of Object.entries(value)) this.textPath(item, `${path}.${key}`);
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
            if (this.options.resolve && !text.includes('{') && this.options.resolve(text) === undefined) {
                const why = this.options.explain?.(text);
                this.errors.push(buildError('SUI-LOGIC-PATH', { target: why === undefined ? text : `${text} (${why})`, path, statePath: path }));
            }
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

    delay(value: JsonValue | undefined, path: string): number | undefined {
        if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_DELAY) return value;
        this.shape(path, `a delay must be a whole number of milliseconds from 1 to ${MAX_DELAY}`);
        return undefined;
    }

    trigger(value: JsonValue | undefined, path: string, place: TriggerPlace): { trigger?: LogicTrigger; captures: string[] } {
        const results = place.results;
        if (!isObject(value)) {
            this.shape(path, '"when" must be an object');
            return { captures: [] };
        }
        this.unknownKeys(value, TRIGGER_KEYS, path);
        const before = this.errors.length;
        const trigger: LogicTrigger = {};
        let captures: string[] = [];
        this.captures = captures;
        const hasPath = Object.hasOwn(value, 'path');
        const hasResult = Object.hasOwn(value, 'result');
        const hasAfter = Object.hasOwn(value, 'after');
        if (Number(hasPath) + Number(hasResult) + Number(hasAfter) !== 1) this.shape(path, '"when" needs exactly one of "path", "result" and "after"');
        if (hasAfter) {
            if (!place.machine) this.shape(`${path}.after`, 'only a machine transition can wait for a time');
            else if (!place.from) this.shape(`${path}.after`, '"after" needs "from" on its transition');
            const ms = this.delay(value['after'], `${path}.after`);
            if (ms !== undefined) trigger.after = ms;
        }
        if (Object.hasOwn(value, 'debounce')) {
            if (!hasPath) this.shape(`${path}.debounce`, '"debounce" needs "path"');
            const ms = this.delay(value['debounce'], `${path}.debounce`);
            if (ms !== undefined) trigger.debounce = ms;
        }
        if (hasPath) {
            const text = value['path'];
            const pattern = typeof text === 'string' ? compilePattern(text) : undefined;
            const root = pattern?.steps[0];
            if (!pattern || root?.kind !== 'literal' || !LOGIC_ROOTS.includes(root.text)) {
                this.errors.push(buildError('SUI-LOGIC-PATH', { target: String(text), path: `${path}.path`, statePath: `${path}.path` }));
            } else {
                trigger.path = pattern.source;
                captures = captureNames(pattern);
                this.captures = captures;
            }
        }
        if (hasResult) {
            const name = value['result'];
            if (typeof name !== 'string' || !results.includes(name)) {
                const owner = place.machine ? 'of the machine' : 'of a rule or table';
                this.shape(`${path}.result`, `no command ${owner} is named "${String(name)}" with "as"`);
            } else trigger.result = name;
        }
        if (Object.hasOwn(value, 'is')) trigger.is = value['is'] as JsonValue;
        if (Object.hasOwn(value, 'was')) {
            if (!hasPath) this.shape(`${path}.was`, '"was" needs "path"');
            trigger.was = value['was'] as JsonValue;
        }
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

    command(value: JsonValue, path: string, captures: readonly string[], guard: boolean, machine = false): LogicCommand | undefined {
        if (!isObject(value)) {
            this.shape(path, 'a command must be an object');
            return undefined;
        }
        const before = this.errors.length;
        this.captures = captures;
        this.unknownKeys(value, LOGIC_COMMAND_KEYS, path);
        const name = value['command'];
        if (typeof name !== 'string' || !(LOGIC_COMMANDS as readonly string[]).includes(name)) {
            this.errors.push(buildError('SUI-LOGIC-COMMAND', { command: String(name), path, statePath: path }));
            return undefined;
        }
        const command = name as LogicCommand['command'];
        if (command === 'reject' && !guard) this.shape(path, '"reject" must be the only command of a rule');
        if (command === 'call' && !machine) this.shape(path, '"call" runs only in a machine, which waits for its result');
        if (command === 'call' && !Object.hasOwn(value, 'as')) this.shape(path, '"call" needs "as"');
        for (const key of REQUIRED[command]) {
            if (!Object.hasOwn(value, key)) this.shape(path, `"${command}" needs "${key}"`);
        }
        for (const key of PATH_KEYS) {
            if (!Object.hasOwn(value, key)) continue;
            const text = value[key];
            if (typeof text !== 'string' || text === '') {
                this.shape(`${path}.${key}`, `"${key}" must be a path`);
            } else if (!((command === 'notify' || command === 'emit' || command === 'call' || command === 'navigate') && key === 'target')) {
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
        if (Object.hasOwn(value, 'value')) this.textPath(value['value'], `${path}.value`);
        return this.errors.length === before ? (value as unknown as LogicCommand) : undefined;
    }

    commands(value: JsonValue | undefined, path: string, captures: readonly string[], options: { required: boolean; guard: boolean; machine?: boolean }): LogicCommand[] | undefined {
        if (value === undefined && !options.required) return [];
        if (!Array.isArray(value) || (options.required && value.length === 0)) {
            this.shape(path, '"do" must be a list of commands');
            return undefined;
        }
        const commands = value.map((item, index) => this.command(item, `${path}.${index}`, captures, options.guard, options.machine));
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
            const { trigger, captures } = this.trigger(item['when'], `${at}.when`, { results, machine: true, from: Object.hasOwn(item, 'from') });
            const commands = this.commands(item['do'], `${at}.do`, captures, { required: false, guard: false, machine: true });
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
        const { trigger, captures } = this.trigger(value['when'], `${path}.when`, { results: this.sharedResults });
        const list = value['do'];
        const guard = Array.isArray(list) && list.length === 1 && isObject(list[0]) && list[0]['command'] === 'reject';
        const commands = this.commands(list, `${path}.do`, captures, { required: true, guard });
        if (guard && trigger !== undefined && trigger.path === undefined) this.shape(`${path}.when`, 'a guard answers a proposed change and needs "path"');
        if (guard && trigger?.debounce !== undefined) this.shape(`${path}.when.debounce`, 'a guard answers at once and cannot debounce');
        return this.errors.length === before && trigger && commands ? { when: trigger, do: commands } : undefined;
    }

    table(value: JsonValue, path: string): LogicTable | undefined {
        if (!isObject(value)) {
            this.shape(path, 'a table must be an object');
            return undefined;
        }
        const before = this.errors.length;
        this.unknownKeys(value, TABLE_KEYS, path);
        const { trigger, captures } = this.trigger(value['when'], `${path}.when`, { results: this.sharedResults });
        const names: string[] = [];
        const inputs = value['inputs'];
        if (inputs !== undefined) {
            if (!isObject(inputs)) {
                this.shape(`${path}.inputs`, '"inputs" must be a map of names to values');
            } else {
                for (const [name, input] of Object.entries(inputs)) {
                    const at = `${path}.inputs.${name}`;
                    if (!INPUT_NAME.test(name) || (SCOPE_NAMES as readonly string[]).includes(name) || captures.includes(name)) {
                        this.shape(at, `"${name}" cannot be an input name`);
                        continue;
                    }
                    names.push(name);
                    if (typeof input === 'string' && (input.startsWith('$.') || input.startsWith('^'))) this.statePath(input, at, captures);
                    else this.templates(input, at);
                    this.textPath(input, at);
                }
            }
        }
        const list = value['rows'];
        if (!Array.isArray(list) || list.length === 0) {
            this.shape(`${path}.rows`, '"rows" must be a non-empty list');
            return undefined;
        }
        const rows: LogicRow[] = [];
        list.forEach((item, index) => {
            const at = `${path}.rows.${index}`;
            if (!isObject(item)) {
                this.shape(at, 'a row must be an object');
                return;
            }
            this.unknownKeys(item, ROW_KEYS, at);
            const row: LogicRow = { do: [] };
            const match = item['match'];
            if (match !== undefined) {
                if (!isObject(match)) {
                    this.shape(`${at}.match`, '"match" must be a map of input names to values');
                } else {
                    for (const name of Object.keys(match)) if (!names.includes(name)) this.shape(`${at}.match.${name}`, `"${name}" is not an input of the table`);
                    row.match = match;
                }
            }
            if (Object.hasOwn(item, 'if')) {
                const text = item['if'];
                if (typeof text !== 'string' || text.trim() === '') {
                    this.shape(`${at}.if`, '"if" must be an expression');
                } else {
                    const whole = /^\{\{([\s\S]+)\}\}$/.exec(text.trim());
                    this.expression(whole ? (whole[1] as string).trim() : text, `${at}.if`);
                    row.if = text;
                }
            }
            if (row.match === undefined && row.if === undefined && index !== list.length - 1) this.shape(at, 'a row with neither "match" nor "if" is the default and must be last');
            const commands = this.commands(item['do'], `${at}.do`, [...captures, ...names], { required: true, guard: false });
            if (commands) row.do = commands;
            rows.push(row);
        });
        const table: LogicTable = { when: trigger ?? {}, rows };
        if (inputs !== undefined && isObject(inputs)) table.inputs = inputs;
        return this.errors.length === before && trigger ? table : undefined;
    }
}

/** The `as` names of the commands of the rules and of the rows of the tables */
function sharedResultNames(root: JsonObject): string[] {
    const names: string[] = [];
    const collect = (list: JsonValue | undefined): void => {
        if (!Array.isArray(list)) return;
        for (const command of list) if (isObject(command) && typeof command['as'] === 'string') names.push(command['as']);
    };
    for (const rule of Object.values(isObject(root['rules']) ? root['rules'] : {})) if (isObject(rule)) collect(rule['do']);
    for (const table of Object.values(isObject(root['tables']) ? root['tables'] : {})) {
        if (!isObject(table) || !Array.isArray(table['rows'])) continue;
        for (const row of table['rows']) if (isObject(row)) collect(row['do']);
    }
    return names;
}

/**
 * Reads the `logic` root of a document: the keyed maps `machines`, `rules` and `tables`. Reports `SUI-LOGIC-SHAPE` (an unknown
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
    reader.unknownKeys(root, ['machines', 'rules', 'tables'], '$.logic');
    reader.sharedResults = sharedResultNames(root);
    for (const key of ['machines', 'rules', 'tables'] as const) {
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
            } else if (key === 'rules') {
                const rule = reader.rule(entry, path);
                if (rule) (logic.rules ??= {})[name] = rule;
            } else {
                const table = reader.table(entry, path);
                if (table) (logic.tables ??= {})[name] = table;
            }
        }
    }
    return { logic, errors: [...reader.errors, ...reader.warnings] };
}
