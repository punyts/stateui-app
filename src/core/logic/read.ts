import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { isObject } from '../resolve/merge.js';
import type { JsonObject, JsonValue } from '../types.js';
import { captureNames, compilePattern, expressionPaths, fillCaptures, isStatePath, mayTouch, writeSteps } from './pattern.js';
import { MAX_TABLE_CELLS, compileTable } from './table.js';
import { LOGIC_COMMAND_KEYS, LOGIC_COMMANDS, MAX_DELAY } from './types.js';
import type { LogicCommand, LogicDocument, LogicMachine, LogicRule, LogicTable, LogicTableRow, LogicTransition, LogicTrigger } from './types.js';
import { LogicError, SCOPE_NAMES, compileExpression, templateExpressions, withCaptures } from './values.js';

/** The roots logic may watch and write; `$.server` is refused outside Full mode by the document check */
const LOGIC_ROOTS = ['app', 'data', 'server', 'screens', 'route'];

const MACHINE_KEYS = ['state', 'initial', 'transitions'];
const TRANSITION_KEYS = ['from', 'when', 'do', 'to'];
const RULE_KEYS = ['when', 'do'];
const TABLE_KEYS = ['inputs', 'outputs', 'rows'];
const INPUT_KEYS = ['path', 'value', 'values', 'breaks'];
const TRIGGER_KEYS = ['path', 'result', 'is', 'was', 'if', 'after', 'debounce'];
const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Where a trigger is: a machine transition (with the result names of its machine and whether it has `from`), or a rule
 * (with the result names of the rules)
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
    /** The path the units are reported under: `$.logic` (the default) for a document, `$` for a logic module */
    root?: string;
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
    /** The `as` names of the commands of rules, which a rule can wait for */
    sharedResults: readonly string[] = [];

    constructor(private readonly options: ReadLogicOptions) {}

    shape(path: string, name: string): void {
        this.errors.push(buildError('SUI-LOGIC-SHAPE', { path, name, statePath: path }));
    }

    unknownKeys(value: JsonObject, allowed: readonly string[], path: string): void {
        // The allowed keys go in the message: without them an agent probes with made-up keys and then guesses
        const known = allowed.map((key) => `"${key}"`).join(', ');
        for (const key of Object.keys(value)) if (!allowed.includes(key)) this.shape(`${path}.${key}`, `unknown key "${key}" (the keys here are ${known})`);
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
                const owner = place.machine ? 'of the machine' : 'of a rule';
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

    /** A path a table reads or writes: a state path (with the table's captures) or a node reference */
    private tablePath(text: JsonValue | undefined, at: string, captures: readonly string[]): text is string {
        if (typeof text !== 'string' || text === '' || !(text.startsWith('$.') || text.startsWith('^'))) {
            this.shape(at, 'a path must be a state path ("$.data.x") or a node reference ("^name.x")');
            return false;
        }
        this.statePath(text, at, captures);
        return true;
    }

    /** One input of a table; returns its captures (undefined for an input that names no path) */
    private tableInput(name: string, raw: JsonValue | undefined, at: string): { captures?: string[]; key: boolean; keys: boolean } {
        const input = typeof raw === 'string' ? { path: raw } : raw;
        if (!isObject(input)) {
            this.shape(at, 'an input is a path, or { "path" or "value", "values" or "breaks" }');
            return { key: false, keys: false };
        }
        this.unknownKeys(input, INPUT_KEYS, at);
        const hasPath = Object.hasOwn(input, 'path');
        if (hasPath === Object.hasOwn(input, 'value')) this.shape(at, `input "${name}" needs exactly one of "path" and "value"`);
        let captures: string[] | undefined;
        if (hasPath) {
            const text = input['path'];
            const pattern = typeof text === 'string' && text.startsWith('$.') ? compilePattern(text) : undefined;
            if (pattern?.steps.some((step) => step.kind === 'any')) this.shape(`${at}.path`, 'an input path cannot have "*"; use "{name}" to run the table per record');
            captures = pattern ? captureNames(pattern) : [];
            this.tablePath(text, `${at}.path`, captures);
        }
        const value = input['value'];
        if (Object.hasOwn(input, 'value') && (typeof value !== 'string' || !/^\{\{[\s\S]+\}\}$/.test(value.trim()))) {
            this.shape(`${at}.value`, '"value" must be one {{ … }} expression');
        }
        const hasValues = Object.hasOwn(input, 'values');
        const hasBreaks = Object.hasOwn(input, 'breaks');
        if (hasValues && hasBreaks) this.shape(at, `input "${name}" takes "values" or "breaks", not both`);
        let keys = false;
        if (hasValues) {
            const values = input['values'];
            if (isObject(values)) {
                this.unknownKeys(values, ['keys'], `${at}.values`);
                if (this.tablePath(values['keys'], `${at}.values.keys`, [])) keys = true;
            } else if (!Array.isArray(values) || values.length === 0) {
                this.shape(`${at}.values`, '"values" must be a non-empty list of values, or { "keys": "<data map path>" }');
            } else if (new Set(values.map((item) => JSON.stringify(item))).size !== values.length) {
                this.shape(`${at}.values`, '"values" lists a value twice');
            }
        }
        if (hasBreaks) {
            const breaks = input['breaks'];
            const ascending =
                Array.isArray(breaks) &&
                breaks.length > 0 &&
                breaks.every((item, index) => typeof item === 'number' && Number.isFinite(item) && (index === 0 || item > (breaks[index - 1] as number)));
            if (!ascending) this.shape(`${at}.breaks`, '"breaks" must be a non-empty list of ascending numbers');
        }
        return { ...(captures === undefined ? {} : { captures }), key: hasValues || hasBreaks, keys };
    }

    table(value: JsonValue, path: string): LogicTable | undefined {
        if (!isObject(value)) {
            this.shape(path, 'a table must be an object { "inputs", "outputs", "rows" }');
            return undefined;
        }
        const before = this.errors.length;
        this.unknownKeys(value, TABLE_KEYS, path);
        const inputs = value['inputs'];
        const outputs = value['outputs'];
        const rows = value['rows'];
        const names: string[] = [];
        let captures: string[] | undefined;
        let fromData = false;
        const nameProblem = (name: string): string | undefined => {
            if (!INPUT_NAME.test(name) || (SCOPE_NAMES as readonly string[]).includes(name)) return `"${name}" cannot be a name of a table's input or output`;
            if (names.includes(name)) return `"${name}" is both an input and an output`;
            return undefined;
        };
        if (!isObject(inputs) || Object.keys(inputs).length === 0) {
            this.shape(`${path}.inputs`, '"inputs" must be a map of input names to inputs');
        } else {
            for (const [name, input] of Object.entries(inputs)) {
                const at = `${path}.inputs.${name}`;
                const problem = nameProblem(name);
                if (problem !== undefined) {
                    this.shape(at, problem);
                    continue;
                }
                names.push(name);
                const read = this.tableInput(name, input, at);
                if (read.keys) fromData = true;
                if (read.captures !== undefined && read.captures.length > 0) {
                    if (captures !== undefined && captures.join(',') !== read.captures.join(',')) {
                        this.shape(`${at}.path`, `the input paths that capture must capture the same names (${captures.map((item) => `{${item}}`).join(', ')})`);
                    }
                    captures ??= read.captures;
                }
            }
        }
        const captured = captures ?? [];
        // the value expressions of inputs may use the captures of the input paths
        if (isObject(inputs)) {
            for (const [name, input] of Object.entries(inputs)) {
                if (isObject(input) && typeof input['value'] === 'string') {
                    this.captures = captured;
                    this.templates(input['value'], `${path}.inputs.${name}.value`);
                }
            }
        }
        if (!isObject(outputs) || Object.keys(outputs).length === 0) {
            this.shape(`${path}.outputs`, '"outputs" must be a map of output names to the state paths they write');
        } else {
            for (const [name, target] of Object.entries(outputs)) {
                const at = `${path}.outputs.${name}`;
                const problem = nameProblem(name);
                if (problem !== undefined) this.shape(at, problem);
                else this.tablePath(target, at, captured);
            }
        }
        if (isObject(rows)) {
            this.unknownKeys(rows, ['from'], `${path}.rows`);
            if (this.tablePath(rows['from'], `${path}.rows.from`, [])) fromData = true;
        } else if (!Array.isArray(rows) || rows.length === 0) {
            this.shape(`${path}.rows`, '"rows" must be a non-empty list of rows, or { "from": "<data map path>" }');
        } else if (this.errors.length === before) {
            const table = { inputs: inputs as unknown as LogicTable['inputs'], outputs: outputs as unknown as LogicTable['outputs'] };
            // the output values are literals or templates over the inputs and captures
            rows.forEach((row, index) => {
                if (!isObject(row)) return;
                for (const name of Object.keys(table.outputs)) {
                    if (!Object.hasOwn(row, name)) continue;
                    this.captures = captured;
                    this.templates(row[name], `${path}.rows.${index}.${name}`);
                    this.textPath(row[name], `${path}.rows.${index}.${name}`);
                }
            });
            if (fromData) {
                // the values of a { keys } input are only known when the table runs: check the names of the row keys only
                rows.forEach((row, index) => {
                    if (!isObject(row)) {
                        this.shape(`${path}.rows.${index}`, 'a row must be an object of input conditions and output values');
                        return;
                    }
                    for (const name of Object.keys(row)) {
                        if (!Object.hasOwn(table.inputs, name) && !Object.hasOwn(table.outputs, name)) this.shape(`${path}.rows.${index}.${name}`, `"${name}" is neither a key input nor an output of the table`);
                    }
                });
            } else {
                for (const problem of compileTable(table, rows as LogicTableRow[]).problems) {
                    const at = `${path}.${problem.at}`;
                    if (problem.code === 'shape') this.shape(at, problem.message);
                    else if (problem.code === 'gap') this.errors.push(buildError('SUI-LOGIC-GAP', { path: at, name: problem.message, statePath: at }));
                    else if (problem.code === 'unreachable') this.warnings.push(buildError('SUI-LOGIC-UNREACHABLE', { path: at, statePath: at }));
                    else this.warnings.push(buildError('SUI-LOGIC-SIZE', { path: at, actual: problem.message, limit: String(MAX_TABLE_CELLS), statePath: at }));
                }
            }
        }
        return this.errors.length === before ? (value as unknown as LogicTable) : undefined;
    }
}

/** The state paths a table reads: its input paths, the paths its value expressions read, and the data its rows and values come from */
export function tableReads(table: LogicTable): string[] {
    const paths: string[] = [];
    for (const raw of Object.values(table.inputs)) {
        const input = typeof raw === 'string' ? { path: raw } : raw;
        if (input.path !== undefined) paths.push(input.path);
        if (input.value !== undefined) paths.push(...expressionPaths(input.value));
        if (isObject(input.values as JsonValue) && typeof (input.values as { keys: string }).keys === 'string') paths.push((input.values as { keys: string }).keys);
    }
    if (!Array.isArray(table.rows)) paths.push(table.rows.from);
    return paths;
}

/** A unit that declares what it reads and writes (a table, a compute), for the cycle check */
interface DeclaredUnit {
    /** The unit's place under the logic root: `tables.shipping` */
    readonly key: string;
    readonly reads: readonly string[];
    readonly writes: readonly string[];
}

/**
 * Reports `SUI-LOGIC-CYCLE` at each declared unit that feeds itself, through its own outputs or those of other declared
 * units (a write that can touch a path another reads), since such units would never settle. Returns their keys
 */
function declaredCycles(units: readonly DeclaredUnit[], root: string, errors: BuildError[]): Set<string> {
    const reads = units.map((unit) => unit.reads.flatMap((path) => compilePattern(path) ?? []));
    const writes = units.map((unit) => unit.writes.filter((path) => path.startsWith('$.')).map(writeSteps));
    const feeds = units.map((_, from) => units.flatMap((__, to) => ((reads[to] ?? []).some((pattern) => (writes[from] ?? []).some((steps) => mayTouch(pattern, steps))) ? [to] : [])));
    const cyclic = new Set<string>();
    units.forEach((unit, start) => {
        // the shortest way back to the unit, breadth first
        const cameFrom = new Map<number, number>();
        const queue = [...(feeds[start] ?? [])];
        for (const next of queue) cameFrom.set(next, start);
        while (queue.length > 0 && !cameFrom.has(start)) {
            const at = queue.shift() as number;
            for (const next of feeds[at] ?? []) {
                if (cameFrom.has(next)) continue;
                cameFrom.set(next, at);
                queue.push(next);
            }
        }
        if (!cameFrom.has(start)) return;
        const trail = [unit.key];
        for (let at = cameFrom.get(start) as number; at !== start; at = cameFrom.get(at) as number) trail.unshift((units[at] as DeclaredUnit).key);
        trail.unshift(unit.key);
        const path = `${root}.${unit.key}`;
        errors.push(buildError('SUI-LOGIC-CYCLE', { path, name: trail.join(' → '), statePath: path }));
        cyclic.add(unit.key);
    });
    return cyclic;
}

/** The `as` names of the commands of the rules */
function sharedResultNames(root: JsonObject): string[] {
    const names: string[] = [];
    const collect = (list: JsonValue | undefined): void => {
        if (!Array.isArray(list)) return;
        for (const command of list) if (isObject(command) && typeof command['as'] === 'string') names.push(command['as']);
    };
    for (const rule of Object.values(isObject(root['rules']) ? root['rules'] : {})) if (isObject(rule)) collect(rule['do']);
    return names;
}

/**
 * Reads the `logic` root of a document: the keyed maps `machines`, `rules` and `tables`. Reports `SUI-LOGIC-SHAPE` (an unknown
 * key, a wrong type, a missing field), `SUI-LOGIC-COMMAND` (an unknown command), `SUI-LOGIC-PATH` (a path that is not
 * under `$.app`, `$.data` or `$.server`, a capture the trigger does not have, or a node reference that does not
 * resolve), `SUI-LOGIC-STATE` (a `from` or `to` that is neither the machine's `initial` nor the `to` of a transition)
 * and `SUI-LOGIC-EXPRESSION` (an expression that does not compile), each with its state path. A table's rows are
 * compiled: `SUI-LOGIC-GAP` (a combination no row covers), `SUI-LOGIC-UNREACHABLE` and `SUI-LOGIC-SIZE` (warnings),
 * and `SUI-LOGIC-CYCLE` for tables that feed each other. The result keeps only the units without errors, so an engine
 * never runs a broken one
 */
export function readLogic(value: unknown, options: ReadLogicOptions = {}): ReadLogicResult {
    const reader = new Reader(options);
    const root = options.root ?? '$.logic';
    const logic: LogicDocument = {};
    if (value === undefined) return { logic, errors: [] };
    if (!isObject(value as JsonValue)) {
        reader.shape(root, '"logic" must be an object');
        return { logic, errors: reader.errors };
    }
    const units = value as JsonObject;
    reader.unknownKeys(units, ['machines', 'rules', 'tables'], root);
    reader.sharedResults = sharedResultNames(units);
    for (const key of ['machines', 'rules', 'tables'] as const) {
        if (!Object.hasOwn(units, key)) continue;
        const map = units[key];
        if (!isObject(map)) {
            reader.shape(`${root}.${key}`, `"${key}" must be a keyed map`);
            continue;
        }
        for (const [name, entry] of Object.entries(map)) {
            const path = `${root}.${key}.${name}`;
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
    const declared: DeclaredUnit[] = Object.entries(logic.tables ?? {}).map(([name, table]) => ({ key: `tables.${name}`, reads: tableReads(table), writes: Object.values(table.outputs) }));
    // a unit in a cycle never runs
    for (const key of declaredCycles(declared, root, reader.errors)) {
        const [kind, name] = key.split('.') as ['tables', string];
        delete logic[kind]?.[name];
    }
    return { logic, errors: [...reader.errors, ...reader.warnings] };
}
