import type { JsonValue } from '../types.js';
import { runCommand } from './commands.js';
import { createEffectRunner } from './effects.js';
import type { CommandContext } from './commands.js';
import { PathIndex } from './pathIndex.js';
import { captureNames, compilePattern, expressionPaths, fillCaptures, matchPattern, mayTouch, pathSteps, writeSteps } from './pattern.js';
import type { PathPattern, PatternMatch } from './pattern.js';
import { columnIndex, compileTable, inputObject, lookupRow, tableColumns } from './table.js';
import type { CompiledTable } from './table.js';
import { LOGIC_FUNCTIONS, LogicError, condition, resolvePath, resolveValue } from './values.js';
import type { Scope } from './values.js';
import { WorkingCopy, covers, placed, within } from './working.js';
import { MAX_CHAIN_DEPTH } from './types.js';
import { ROUTE_PATH } from '../route/index.js';
import { cloneJson, isObject } from '../resolve/merge.js';
import type {
    LogicChange,
    LogicCommand,
    LogicCompute,
    LogicDocument,
    LogicEffectInfo,
    LogicFailure,
    LogicHost,
    LogicMachine,
    LogicResult,
    LogicTable,
    LogicTableInput,
    LogicTableRow,
    LogicTraceEvent,
    LogicTraceRun,
    LogicTransition,
    LogicUnitKind,
    LogicWrite
} from './types.js';

/** The most results one call follows, so results that keep producing results end */
const MAX_RESULTS = 64;

/** The runs the trace keeps, the events it keeps of one run, and the write paths it keeps of one event */
const MAX_TRACE_RUNS = 25;
const MAX_TRACE_EVENTS = 200;
const MAX_TRACE_WRITES = 20;

/** An input of a table or compute unit as the engine reads it */
interface TableInputPlan {
    name: string;
    input: LogicTableInput;
    /** The path pattern of a path input (a node reference resolved when the engine starts) */
    pattern?: PathPattern;
}

/**
 * A unit that declares its inputs and outputs, as the engine runs it: a table (its compiled rows) or a compute unit
 * (the function it runs); its inputs, its captures, its outputs
 */
interface DeclaredPlan {
    table?: LogicTable;
    compute?: LogicCompute;
    outputs: Readonly<Record<string, string>>;
    inputs: TableInputPlan[];
    /** The names its input paths capture, so it runs per record; empty for a table that runs once */
    captures: string[];
    /** The number of its unit's trigger patterns that are inputs; the rest are the data its rows and values come from */
    inputTriggers: number;
    /** The last version of its rows that compiled; absent until rows from data compile */
    compiled?: CompiledTable;
    /** True when the data its rows or values come from changed since it was compiled */
    stale: boolean;
}

/**
 * A machine, a rule as a machine with one state and one transition, or a table, whose transitions are one trigger per
 * input path (and per path its rows and values come from) with no commands
 */
interface Unit {
    id: string;
    kind: Exclude<LogicUnitKind, 'guard' | 'chain'>;
    name: string;
    machine?: LogicMachine;
    declared?: DeclaredPlan;
    transitions: LogicTransition[];
    patterns: (PathPattern | undefined)[];
}

interface Hit {
    transition: LogicTransition;
    /** The index of the transition in its unit, which keys its debounce timer */
    index: number;
    state?: string;
    trigger?: JsonValue;
    previous?: JsonValue;
    captures: Record<string, string>;
    result?: LogicResult;
    /** The concrete path that matched */
    path?: string;
}

interface Guard {
    name: string;
    pattern: PathPattern;
    trigger: LogicTransition['when'];
    reason: string;
}

type Results = { unit: Unit; name: string; result: LogicResult }[];

export interface LogicEngine {
    /** The machine, rule, table and guard names, machines first */
    readonly names: readonly string[];
    /**
     * Writes each machine's `initial` state where its state path has no value, in one commit, then (unless `derive` is
     * false) runs `derive`, and arms `after` timers
     */
    start(options?: { derive?: boolean }): void;
    /**
     * Runs each table (for every record) and each rule that only derives values (path triggers without `was`; only
     * `set`, `merge`, `copy` and `query`) once, in chain order, as if the data at its trigger paths had just arrived,
     * so derived values are right before the first change. Rules that act (`notify`, `navigate`, data commands,
     * `toggle`...) and machines wait
     */
    derive(): void;
    /** Looks up changes the host has applied and runs the transitions they trigger, their chains and results */
    changes(changes: readonly LogicChange[]): void;
    /** The reason a guard rule refuses a proposed change, or undefined when none does */
    guard(change: LogicChange): string | undefined;
    /** The guard rule that refuses a proposed change and its reason, or undefined when none does */
    refusal(change: LogicChange): { name: string; reason: string } | undefined;
    /** The last runs of the engine, oldest first: what started each and what every unit whose path matched did */
    trace(): LogicTraceRun[];
    /** Forgets the trace */
    clearTrace(): void;
    /** Each effect: the token it last acted on, whether a call is running, and how many answers its cache holds */
    effects(): LogicEffectInfo[];
    /** Cancels every timer and running effect, and ignores call and effect answers that arrive later */
    stop(): void;
}

function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function parentOf(path: string): string {
    return path.slice(0, path.lastIndexOf('.'));
}

/** True when the change removed `path` together with its parent: a record went away, not the value at the path */
function removedWithParent(path: string, change: LogicChange, read: (path: string) => JsonValue | undefined): boolean {
    return change.path !== path && covers(change.path, path) && read(path) === undefined && read(parentOf(path)) === undefined;
}

/** The keys of a command whose path it writes; `notify`, `emit`, `call` and `navigate` name no state path in `target` */
const WRITE_KEYS = ['target', 'into'] as const;
const NOT_WRITES = new Set(['notify', 'emit', 'call', 'reject', 'navigate']);

/** The commands of a unit's transitions; a table has none */
function unitCommands(unit: { transitions: readonly LogicTransition[] }): LogicCommand[] {
    return unit.transitions.flatMap((transition) => transition.do ?? []);
}

/**
 * The state paths a unit can write, as written (`$.data.bag.{id}.total`): its commands' targets, its machine's state
 * path, a table's outputs. Node references (`^name`) resolve at run time and are left out
 */
function writePaths(unit: { machine?: LogicMachine; transitions: readonly LogicTransition[]; declared?: DeclaredPlan }): string[] {
    const paths = unitCommands(unit).flatMap((command) => {
        if (command.command === 'navigate') return [ROUTE_PATH];
        return NOT_WRITES.has(command.command) ? [] : WRITE_KEYS.flatMap((key) => (typeof command[key] === 'string' ? [command[key] as string] : []));
    });
    if (unit.machine) paths.push(unit.machine.state);
    if (unit.declared) paths.push(...Object.values(unit.declared.outputs));
    return paths.filter((path) => path.startsWith('$.'));
}

/**
 * The units in the order a chain looks them up: document order (machines, rules, tables), except that a unit comes
 * after the other units whose commands can write under its trigger paths, so a rule over `$.data.bag` that sums line
 * totals sees the totals a table writes in the same step. Units that depend on each other in a cycle keep document order
 */
function chainOrder<T extends { id: string; machine?: LogicMachine; declared?: DeclaredPlan; transitions: readonly LogicTransition[]; patterns: readonly (PathPattern | undefined)[] }>(units: readonly T[]): T[] {
    const writes = new Map(units.map((unit) => [unit.id, writePaths(unit).map(writeSteps)]));
    const before = new Map(
        units.map((unit) => [
            unit.id,
            units.filter(
                (other) =>
                    other.id !== unit.id &&
                    unit.patterns.some((pattern) => pattern !== undefined && (writes.get(other.id) ?? []).some((steps) => mayTouch(pattern, steps)))
            )
        ])
    );
    const placed = new Set<string>();
    const order: T[] = [];
    while (order.length < units.length) {
        const remaining = units.filter((unit) => !placed.has(unit.id));
        const ready = remaining.find((unit) => (before.get(unit.id) ?? []).every((other) => placed.has(other.id)));
        // A cycle: the remaining unit that the fewest remaining units must precede goes next, in document order
        const next =
            ready ??
            remaining.reduce((best, unit) => {
                const waits = (candidate: T): number => (before.get(candidate.id) ?? []).filter((other) => !placed.has(other.id)).length;
                return waits(unit) < waits(best) ? unit : best;
            });
        placed.add(next.id);
        order.push(next);
    }
    return order;
}

/**
 * The plan of a table or compute unit, and the patterns it runs on: one per input path or path an input's value
 * expression reads, then the data a table's rows and values come from
 */
function declaredPlan(unit: { table: LogicTable } | { compute: LogicCompute }, resolve?: (reference: string) => string | undefined): { plan: DeclaredPlan; patterns: (PathPattern | undefined)[] } {
    const table = 'table' in unit ? unit.table : undefined;
    const declared = 'table' in unit ? unit.table : unit.compute;
    const statePath = (path: string): string | undefined => (path.startsWith('^') ? resolve?.(path) : path);
    const inputs: TableInputPlan[] = [];
    const patterns: (PathPattern | undefined)[] = [];
    const captures: string[] = [];
    for (const [name, raw] of Object.entries(declared.inputs)) {
        const input = inputObject(raw);
        const path = input.path === undefined ? undefined : statePath(input.path);
        const pattern = path === undefined ? undefined : compilePattern(path);
        inputs.push({ name, input, ...(pattern === undefined ? {} : { pattern }) });
        if (pattern) {
            patterns.push(pattern);
            if (captures.length === 0) captures.push(...captureNames(pattern));
        }
        if (input.value !== undefined) patterns.push(...expressionPaths(input.value).map((read) => compilePattern(read)));
    }
    const inputTriggers = patterns.length;
    const sources = [
        ...(table === undefined || Array.isArray(table.rows) ? [] : [table.rows.from]),
        ...inputs.flatMap(({ input }) => (isObject(input.values as JsonValue) ? [(input.values as { keys: string }).keys] : []))
    ];
    for (const source of sources) {
        const path = statePath(source);
        patterns.push(path === undefined ? undefined : compilePattern(path));
    }
    const fromData = sources.length > 0;
    const compiled = table === undefined || fromData ? undefined : compileTable(table, table.rows as LogicTableRow[]).compiled;
    const plan: DeclaredPlan = {
        ...('table' in unit ? { table: unit.table } : { compute: unit.compute }),
        outputs: declared.outputs,
        inputs,
        captures,
        inputTriggers,
        ...(compiled === undefined ? {} : { compiled }),
        stale: fromData
    };
    return { plan, patterns };
}

/** The units and guards of a logic document, in document order (machines, rules, tables) */
function buildUnits(logic: LogicDocument, resolve?: (reference: string) => string | undefined): { units: Unit[]; guards: Guard[] } {
    const units: Unit[] = [];
    const guards: Guard[] = [];
    const pattern = (when: LogicTransition['when']): PathPattern | undefined => (when.path === undefined ? undefined : compilePattern(when.path));
    for (const [name, machine] of Object.entries(logic.machines ?? {})) {
        units.push({ id: `machine:${name}`, kind: 'machine', name, machine, transitions: machine.transitions, patterns: machine.transitions.map((transition) => pattern(transition.when)) });
    }
    for (const [name, rule] of Object.entries(logic.rules ?? {})) {
        const compiled = pattern(rule.when);
        if (isGuard(rule.do)) {
            if (compiled) guards.push({ name, pattern: compiled, trigger: rule.when, reason: rule.do[0]?.reason ?? `refused by ${name}` });
            continue;
        }
        units.push({ id: `rule:${name}`, kind: 'rule', name, transitions: [{ when: rule.when, do: rule.do }], patterns: [compiled] });
    }
    for (const [name, table] of Object.entries(logic.tables ?? {})) {
        const { plan, patterns } = declaredPlan({ table }, resolve);
        units.push({ id: `table:${name}`, kind: 'table', name, declared: plan, transitions: patterns.map((item) => ({ when: item === undefined ? {} : { path: item.source } })), patterns });
    }
    for (const [name, compute] of Object.entries(logic.computes ?? {})) {
        const { plan, patterns } = declaredPlan({ compute }, resolve);
        units.push({ id: `compute:${name}`, kind: 'compute', name, declared: plan, transitions: patterns.map((item) => ({ when: item === undefined ? {} : { path: item.source } })), patterns });
    }
    return { units, guards };
}

/** Where a unit runs in a logic document, and the state paths it reads and writes */
export interface LogicUnitPlace {
    readonly kind: 'machine' | 'rule' | 'table' | 'compute' | 'effect' | 'guard';
    readonly name: string;
    /** 1-based place in the order a chain looks units up; absent for a guard, which is asked before a change commits, and an effect, which runs after a chain */
    readonly position?: number;
    /** Trigger paths, table input paths and `from` paths of commands */
    readonly reads: readonly string[];
    /** The paths its commands write, and a machine's state path */
    readonly writes: readonly string[];
}

/** The `$.` paths among a unit's triggers (a table's inputs and data sources) and its commands' `from` keys */
function readPaths(unit: { transitions: readonly LogicTransition[] }): string[] {
    const paths = [...unit.transitions.map((transition) => transition.when.path), ...unitCommands(unit).map((command) => command['from'])];
    return paths.filter((path): path is string => typeof path === 'string' && path.startsWith('$.'));
}

const unique = (paths: readonly string[]): string[] => [...new Set(paths)];

/**
 * The units of a logic document in the order the engine looks them up for a change (`chainOrder`), with the paths each
 * reads and writes, then the guards. For a build tool that says where a written unit runs; it reads no state
 */
export function logicRunOrder(logic: LogicDocument): LogicUnitPlace[] {
    const { units, guards } = buildUnits(logic);
    return [
        ...chainOrder(units).map((unit, index) => ({ kind: unit.kind, name: unit.name, position: index + 1, reads: unique(readPaths(unit)), writes: unique(writePaths(unit)) })),
        ...Object.entries(logic.effects ?? {}).map(([name, effect]) => ({
            kind: 'effect' as const,
            name,
            reads: [effect.request],
            writes: unique([effect.status, ...(effect.records ? [effect.records.into] : []), ...(effect.window === undefined ? [] : [effect.window]), ...(effect.value === undefined ? [] : [effect.value])])
        })),
        ...guards.map((guard) => ({ kind: 'guard' as const, name: guard.name, reads: guard.trigger.path === undefined ? [] : [guard.trigger.path], writes: [] }))
    ];
}

function isGuard(commands: readonly LogicCommand[]): boolean {
    return commands.length === 1 && commands[0]?.command === 'reject';
}

/** The value at `at` before a change: taken from the change's previous value, laid into the current value when the change was below */
/** The commands that only compute state from state, and so may run at start without acting on anything */
const DERIVE_COMMANDS: ReadonlySet<string> = new Set(['set', 'merge', 'copy', 'query']);

/**
 * True for a table, and for a rule that only derives values: every trigger is a `path` with no `was` (which needs a
 * change), and every command is `set`, `merge`, `copy` or `query`. A machine never is
 */
function derivesOnly(unit: Unit): boolean {
    if (unit.declared) return true;
    if (unit.machine) return false;
    if (unit.transitions.some((transition) => transition.when.path === undefined || transition.when.was !== undefined || transition.when.after !== undefined)) return false;
    return unitCommands(unit).every((command) => DERIVE_COMMANDS.has(command.command));
}

/**
 * The changes that make a deriving unit fire at start as if its data had just arrived: for each trigger, a change at
 * its leading literal steps (`$.data` for `$.data.bag.*.qty`) with no previous value, so every concrete path that has
 * a value matches and one with none does not
 */
function startChanges(unit: Unit): LogicChange[] {
    const changes: LogicChange[] = [];
    for (const pattern of unit.patterns) {
        if (!pattern) continue;
        const literal: string[] = [];
        for (const step of pattern.steps) {
            if (step.kind !== 'literal') break;
            literal.push(step.text);
        }
        if (literal.length > 0) changes.push({ path: `$.${literal.join('.')}` });
    }
    return changes;
}

function previousAt(at: string, change: LogicChange, current: JsonValue | undefined): JsonValue | undefined {
    if (at === change.path) return change.previous;
    if (covers(change.path, at)) return within(change.previous, pathSteps(at).slice(pathSteps(change.path).length));
    return placed(current, pathSteps(change.path).slice(pathSteps(at).length), change.previous);
}

/**
 * The logic runner over a host: a browser store or an app server's authority.
 *
 * A change is looked up in an index of the trigger paths (`PathIndex`), which gives the transitions whose paths can
 * match it; those units are tried in chain order: machines, rules and tables, each in document order, except that a
 * unit comes after the units whose commands can write under its trigger paths (see `chainOrder`). A machine
 * considers only the transitions of its current state (or with no `from`) and fires the first that matches; a rule
 * is one transition. A table runs when an input changes, for each record whose inputs changed: its compiled rows give
 * the winning row of the input values, and the outputs that differ from state are committed (see `fireTable`). The commands of a transition run
 * against a working copy and commit together; a failing command commits nothing and reports a failure. The writes of
 * a commit are looked up again as a chain: a machine, rule or table fires at most once per chain, and a chain stops
 * past `MAX_CHAIN_DEPTH`. Named results (`as`) are given after the chain, each starting a chain of its own: a machine's
 * to that machine, a rule's to every rule whose `when.result` names it; a `call`'s result comes when the host answers it. A rule whose commands are one `reject` is a guard and never
 * fires; the host asks `guard` before it applies a change.
 *
 * Time comes from the host (`schedule`). A `debounce` trigger restarts its timer on each matching change and fires
 * with the last one. An `after` transition is armed while its machine is in `from`: the engine compares each machine's
 * state with the state its timers were armed for after every start, change, timer and answer, and re-arms when it
 * moved. A timer that fires checks the machine's state again
 */
export function createLogicEngine(logic: LogicDocument, host: LogicHost): LogicEngine {
    const units: Unit[] = [];
    const guards: Guard[] = [];
    const failed = (failure: LogicFailure): void => host.failed?.(failure);
    let stopped = false;

    const runs: LogicTraceRun[] = [];
    let current: LogicTraceRun | undefined;
    let depthNow = 0;
    const note = (event: Omit<LogicTraceEvent, 'depth'>): void => {
        if (current && current.events.length < MAX_TRACE_EVENTS) current.events.push({ depth: depthNow, ...event });
    };
    /**
     * Runs `work` as a run of the trace of its own, unless it runs inside one. A run in which no unit's trigger
     * matched is not kept, so changes the logic does not look at (a selected tab) do not push the others out
     */
    const traced = (cause: LogicTraceRun['cause'], changes: readonly string[], work: () => void): void => {
        if (current) {
            work();
            return;
        }
        const run: LogicTraceRun = { at: new Date().toISOString(), cause, changes: changes.slice(0, 50), events: [] };
        current = run;
        depthNow = 0;
        try {
            work();
        } finally {
            current = undefined;
            depthNow = 0;
            if (run.events.length > 0) {
                runs.push(run);
                if (runs.length > MAX_TRACE_RUNS) runs.shift();
            }
        }
    };
    const unitFailed = (unit: Unit, details: { from?: string; command?: number; reason: string }): void => {
        note({ kind: unit.kind, name: unit.name, outcome: 'failed', ...details });
        failed({ kind: unit.kind, name: unit.name, ...details });
    };

    const built = buildUnits(logic, host.resolve?.bind(host));
    units.push(...built.units);
    guards.push(...built.guards);

    const ordered = chainOrder(units);

    /** The changes looked up since the effects last settled, for the window rows of changed records */
    const touched: LogicChange[] = [];
    let settling = false;
    const effectNames = Object.keys(logic.effects ?? {});
    const effects =
        effectNames.length === 0
            ? undefined
            : createEffectRunner(logic.effects ?? {}, {
                  host,
                  failed,
                  stopped: () => stopped,
                  now: () => new Date().toISOString(),
                  apply: (name, writes, label) => applyEffect(name, writes, label)
              });
    /**
     * After a run: the effects start, cancel or answer from their cache for requests that changed, and window rows
     * follow changed records; what they write is looked up again, a few rounds at most. Never inside a chain
     */
    const settle = (): void => {
        if (!effects || settling || stopped) return;
        settling = true;
        try {
            for (let round = 0; round < 4; round += 1) {
                const batch = touched.splice(0);
                effects.settle(batch);
                if (touched.length === 0) break;
            }
        } finally {
            touched.length = 0;
            settling = false;
        }
    };
    /** Commits an effect's writes and looks them up as a chain of their own */
    const applyEffect = (name: string, writes: LogicWrite[], label: string): string | undefined => {
        if (stopped || writes.length === 0) return undefined;
        const before = writes.map((write) => host.get(write.path));
        try {
            host.commit(writes);
        } catch (error) {
            const reason = (error as Error).message;
            failed({ kind: 'effect', name, reason });
            return reason;
        }
        const changes = writes.map((write, index) => (before[index] === undefined ? write : { ...write, previous: before[index] }));
        traced('effect', [label], () => {
            note({ kind: 'effect', name, outcome: 'fired', writes: writes.slice(0, MAX_TRACE_WRITES).map((write) => write.path) });
            const results: Results = [];
            chain(changes, new Set(), results);
            drain(results);
        });
        if (!settling) {
            settle();
            arm();
        }
        return undefined;
    };

    /** The trigger paths of every transition, so a change reaches only the transitions whose paths can match it */
    const triggers = new PathIndex<{ unit: string; index: number }>();
    for (const unit of units) {
        unit.patterns.forEach((pattern, index) => {
            if (pattern) triggers.add(pattern, { unit: unit.id, index });
        });
    }
    const guardIndex = new PathIndex<Guard>();
    for (const rule of guards) guardIndex.add(rule.pattern, rule);

    /** The transitions, by unit id, whose trigger paths can match one of the changes */
    const reached = (changes: readonly LogicChange[]): Map<string, Set<number>> => {
        const found = new Set<{ unit: string; index: number }>();
        for (const change of changes) triggers.find(change.path, found);
        const byUnit = new Map<string, Set<number>>();
        for (const { unit, index } of found) {
            let indexes = byUnit.get(unit);
            if (!indexes) byUnit.set(unit, (indexes = new Set()));
            indexes.add(index);
        }
        return byUnit;
    };

    /** Debounce timers by unit and transition index; `after` timers by machine, with the state they were armed for */
    const debounced = new Map<string, () => void>();
    const armed = new Map<string, { state: string | undefined; cancels: (() => void)[] }>();

    const stateOf = (unit: Unit): string | undefined => {
        if (!unit.machine) return undefined;
        const value = host.get(unit.machine.state);
        return typeof value === 'string' ? value : unit.machine.initial;
    };
    const fromOf = (state: string | undefined): { from?: string } => (state === undefined ? {} : { from: state });

    const passes = (when: LogicTransition['when'], scope: Scope, compared: JsonValue | undefined): boolean => {
        if (Object.hasOwn(when, 'is') && !deepEqual(compared, when.is)) return false;
        if (Object.hasOwn(when, 'was') && !deepEqual(scope.previous, when.was)) return false;
        return when.if === undefined || condition(when.if, scope);
    };

    /**
     * Compiles a table again from the data its rows or values come from. A version that does not compile, or leaves a
     * combination without a row, fails the table, which keeps its last good version
     */
    const recompile = (unit: Unit, plan: DeclaredPlan): void => {
        plan.stale = false;
        if (!plan.table) return;
        const table = plan.table;
        const read = (path: string): JsonValue | undefined => host.get(path.startsWith('^') ? (host.resolve?.(path) ?? path) : path);
        const keys = (name: string): JsonValue[] | undefined => {
            const values = plan.inputs.find((input) => input.name === name)?.input.values;
            if (!isObject(values as JsonValue)) return undefined;
            const map = read((values as { keys: string }).keys);
            return isObject(map) ? Object.keys(map) : [];
        };
        let rows: LogicTableRow[];
        if (Array.isArray(table.rows)) rows = table.rows;
        else {
            const map = read(table.rows.from);
            const records = isObject(map) ? Object.entries(map) : [];
            // rows in `order` when the records have it, else in key order
            const order = (record: JsonValue): number => (isObject(record) && typeof record['order'] === 'number' ? record['order'] : Number.POSITIVE_INFINITY);
            rows = records
                .sort(([a, left], [b, right]) => order(left) - order(right) || (a < b ? -1 : a > b ? 1 : 0))
                .map(([, record]) => {
                    if (!isObject(record)) return record as unknown as LogicTableRow;
                    const { order: _order, ...row } = record;
                    return row;
                });
        }
        const { compiled, problems } = compileTable(table, rows, tableColumns(table.inputs, keys));
        const problem = problems.find((item) => item.code === 'shape' || item.code === 'gap');
        if (!compiled || problem) {
            const reason = problem?.code === 'gap' ? `no row for ${problem.message}` : `${problem?.at ?? 'rows'}: ${problem?.message ?? 'the rows do not compile'}`;
            unitFailed(unit, { reason: plan.compiled ? `${reason}; the last good rows stay in use` : reason });
            return;
        }
        plan.compiled = compiled;
    };

    /** The value of a table input for one set of captures */
    const inputValue = (input: TableInputPlan, scope: Scope): JsonValue | undefined => {
        if (input.input.value !== undefined) return resolveValue(input.input.value, scope, host);
        if (input.input.path === undefined) return undefined;
        const path = input.input.path.startsWith('^') ? host.resolve?.(fillCaptures(input.input.path, scope.captures)) : fillCaptures(input.input.path, scope.captures);
        return path === undefined ? undefined : host.get(path);
    };

    /**
     * The winning row of a table for its input values, or why there is none: an input with no value (`missing`, which
     * skips the table), a value it does not list (`outside`, a failure) or no row above `MAX_TABLE_CELLS`
     */
    const tableLookup = (compiled: CompiledTable, values: Readonly<Record<string, JsonValue | undefined>>): number | { skip?: string; fail?: string } => {
        const indexes: number[] = [];
        for (const column of compiled.columns) {
            const index = columnIndex(column, values[column.name]);
            if (index === 'missing') return { skip: `input "${column.name}" has no value` };
            if (index === 'outside') return { fail: `input "${column.name}" is ${JSON.stringify(values[column.name])}, which is not one of its values` };
            indexes.push(index);
        }
        const row = lookupRow(compiled, indexes);
        return row < 0 ? { skip: 'no row matched' } : row;
    };

    /** The capture sets of every record a table runs for: the records its first capturing input path has */
    const allRecords = (plan: DeclaredPlan): Record<string, string>[] => {
        if (plan.captures.length === 0) return [{}];
        const pattern = plan.inputs.find((input) => input.pattern && captureNames(input.pattern).length > 0)?.pattern as PathPattern;
        const literal: string[] = [];
        for (const step of pattern.steps) {
            if (step.kind !== 'literal') break;
            literal.push(step.text);
        }
        const start = `$.${literal.join('.')}`;
        return matchPattern(pattern, start, host.get(start)).map((match) => match.captures);
    };

    /**
     * Runs a table for the records the changes reach (every record with `all`, or when the data its rows come from
     * changed, or when an input that does not capture changed) and commits the outputs that differ from state in one
     * commit. Returns whether it looked a row up, and its writes as changes
     */
    const fireTable = (unit: Unit, changes: readonly LogicChange[], all = false): { ran: boolean; changes: LogicChange[] } => {
        const plan = unit.declared as DeclaredPlan;
        let every = all;
        const records = new Map<string, Record<string, string>>();
        unit.patterns.forEach((pattern, index) => {
            if (!pattern) return;
            for (const change of changes) {
                for (const match of matchPattern(pattern, change.path, host.get(change.path))) {
                    const value = host.get(match.path);
                    if (deepEqual(value, previousAt(match.path, change, value))) {
                        note({ kind: unit.kind, name: unit.name, outcome: 'unchanged', path: match.path });
                        continue;
                    }
                    if (index >= plan.inputTriggers) {
                        plan.stale = true;
                        every = true;
                        continue;
                    }
                    if (value === undefined && removedWithParent(match.path, change, (path) => host.get(path))) {
                        note({ kind: unit.kind, name: unit.name, outcome: 'parent-removed', path: match.path });
                        continue;
                    }
                    const captures = Object.fromEntries(plan.captures.flatMap((name) => (Object.hasOwn(match.captures, name) ? [[name, match.captures[name] as string]] : [])));
                    if (Object.keys(captures).length < plan.captures.length) every = true;
                    else records.set(JSON.stringify(captures), captures);
                }
            }
        });
        if (plan.stale) recompile(unit, plan);
        const compiled = plan.compiled;
        if (plan.table && !compiled) return { ran: false, changes: [] };
        const runFor = every ? allRecords(plan) : [...records.values()];
        if (runFor.length === 0) return { ran: false, changes: [] };

        const copy = new WorkingCopy((path) => host.get(path));
        for (const captures of runFor) {
            const scope: Scope = { read: (path) => copy.get(path), captures, functions };
            try {
                const values: Record<string, JsonValue> = {};
                for (const input of plan.inputs) {
                    const value = inputValue(input, scope);
                    if (value !== undefined) values[input.name] = value;
                }
                const at = plan.captures.length === 0 ? {} : { path: plan.captures.map((name) => `${name}=${captures[name] ?? ''}`).join(', ') };
                let found = -1;
                let results: Readonly<Record<string, JsonValue>>;
                if (plan.compute) {
                    results = runCompute(plan.compute, values);
                } else {
                    const looked = tableLookup(compiled as CompiledTable, values);
                    if (typeof looked !== 'number') {
                        if (looked.fail !== undefined) unitFailed(unit, { reason: looked.fail });
                        else note({ kind: unit.kind, name: unit.name, outcome: 'condition', ...at, reason: looked.skip as string });
                        continue;
                    }
                    found = looked;
                    const withInputs: Scope = { ...scope, inputs: values };
                    const outputs = ((compiled as CompiledTable).rows[found] as CompiledTable['rows'][number]).outputs;
                    results = Object.fromEntries(Object.entries(outputs).map(([name, output]) => [name, resolveValue(output, withInputs, host)]));
                }
                const writes: string[] = [];
                for (const [name, value] of Object.entries(results)) {
                    if (!Object.hasOwn(plan.outputs, name) || value === undefined) continue;
                    const target = resolvePath(plan.outputs[name] as string, scope, host);
                    if (deepEqual(copy.get(target), value)) continue;
                    copy.set(target, value);
                    writes.push(target);
                }
                note({ kind: unit.kind, name: unit.name, outcome: writes.length > 0 ? 'fired' : 'unchanged', ...at, ...(found < 0 ? {} : { row: found }), writes: writes.slice(0, MAX_TRACE_WRITES) });
            } catch (error) {
                unitFailed(unit, { reason: (error as Error).message });
            }
        }
        if (copy.writes.length === 0) return { ran: true, changes: [] };
        const before = copy.writes.map((write) => host.get(write.path));
        try {
            host.commit(copy.writes);
        } catch (error) {
            unitFailed(unit, { reason: (error as Error).message });
            return { ran: true, changes: [] };
        }
        return { ran: true, changes: copy.writes.map((write: LogicWrite, index) => (before[index] === undefined ? write : { ...write, previous: before[index] })) };
    };

    /** `lookup(name, ...inputs)`: the outputs of a table's winning row for the given input values, in input order; null when no row wins */
    const lookup = (name: unknown, ...args: unknown[]): JsonValue => {
        const unit = units.find((item) => item.declared?.table && item.name === name);
        if (!unit?.declared) throw new LogicError(`lookup: "${String(name)}" is not a table`);
        const plan = unit.declared;
        if (plan.stale) recompile(unit, plan);
        if (!plan.compiled) return null;
        const values: Record<string, JsonValue> = {};
        plan.inputs.forEach((input, index) => {
            if (args[index] !== undefined) values[input.name] = args[index] as JsonValue;
        });
        const found = tableLookup(plan.compiled, values);
        if (typeof found !== 'number') return null;
        const scope: Scope = { read: (path) => host.get(path), captures: {}, inputs: values, functions };
        const outputs: Record<string, JsonValue> = {};
        for (const [output, value] of Object.entries((plan.compiled.rows[found] as CompiledTable['rows'][number]).outputs)) outputs[output] = resolveValue(value, scope, host);
        return outputs;
    };
    /** Runs a compute unit's function; throws for a name the host did not register or a result that is not an object */
    const runCompute = (compute: LogicCompute, values: Readonly<Record<string, JsonValue>>): Readonly<Record<string, JsonValue>> => {
        const run = host.functions?.compute?.[compute.run];
        if (!run) throw new LogicError(`the host registered no compute function "${compute.run}"`);
        const result = run(cloneJson(values as JsonValue) as Record<string, JsonValue>) as JsonValue;
        if (!isObject(result)) throw new LogicError(`compute function "${compute.run}" returned ${result === null ? 'null' : typeof result}, not an object of outputs`);
        return result;
    };

    /** The functions expressions get next to the built-in ones: `lookup` and the host's expression functions (not those named like a built-in) */
    const functions: Record<string, (...args: unknown[]) => unknown> = {};
    for (const [name, run] of Object.entries(host.functions?.expressions ?? {})) {
        if (Object.hasOwn(LOGIC_FUNCTIONS, name) || name === 'lookup') failed({ kind: 'compute', name, reason: `"${name}" is a built-in function, so the host's function of that name is not used` });
        else functions[name] = (...args) => run(...(args.map((arg) => cloneJson((arg ?? null) as JsonValue)) as JsonValue[]));
    }
    functions['lookup'] = lookup;

    /**
     * The first transition of the unit's current state that one of the changes triggers. A trigger fires only when the
     * value at its path changed, and not when the path went away with its parent; the trace notes why nothing fired
     */
    const findHit = (unit: Unit, changes: readonly LogicChange[], only?: ReadonlySet<number>): Hit | undefined => {
        const state = stateOf(unit);
        let miss: Omit<LogicTraceEvent, 'depth' | 'kind' | 'name'> | undefined;
        const missed = (outcome: LogicTraceEvent['outcome'], path: string, reason?: string): void => {
            miss ??= { outcome, path, ...(reason === undefined ? {} : { reason }) };
        };
        for (const [index, transition] of unit.transitions.entries()) {
            const compiled = unit.patterns[index];
            if (!compiled || (only !== undefined && !only.has(index))) continue;
            for (const change of changes) {
                const matches = matchPattern(compiled, change.path, host.get(change.path));
                if (matches.length === 0) continue;
                if (transition.from !== undefined && transition.from !== state) {
                    missed('other-state', (matches[0] as PatternMatch).path, `needs state ${transition.from}`);
                    continue;
                }
                for (const match of matches) {
                    const trigger = host.get(match.path);
                    const previous = previousAt(match.path, change, trigger);
                    if (deepEqual(trigger, previous)) {
                        missed('unchanged', match.path);
                        continue;
                    }
                    if (trigger === undefined && removedWithParent(match.path, change, (path) => host.get(path))) {
                        missed('parent-removed', match.path);
                        continue;
                    }
                    const scope: Scope = {
                        read: (path) => host.get(path),
                        trigger: trigger ?? null,
                        previous: previous ?? null,
                        captures: match.captures,
                        functions
                    };
                    try {
                        if (!passes(transition.when, scope, trigger)) {
                            missed('condition', match.path);
                            continue;
                        }
                        const hit: Hit = {
                            transition,
                            index,
                            ...(state === undefined ? {} : { state }),
                            trigger: trigger ?? null,
                            previous: previous ?? null,
                            captures: match.captures,
                            path: match.path
                        };
                        return hit;
                    } catch (error) {
                        unitFailed(unit, { ...fromOf(state), reason: (error as Error).message });
                    }
                }
            }
        }
        if (miss) note({ kind: unit.kind, name: unit.name, ...fromOf(state), ...miss });
        return undefined;
    };

    /** The first concrete path of the unit's triggers that one of the changes matches, whatever its conditions */
    const touches = (unit: Unit, changes: readonly LogicChange[]): string | undefined => {
        for (const compiled of unit.patterns) {
            if (!compiled) continue;
            for (const change of changes) {
                const [match] = matchPattern(compiled, change.path, host.get(change.path));
                if (match) return match.path;
            }
        }
        return undefined;
    };

    /** The guard that refuses a change; a guard sees only changes of the value at its path, not removed parents */
    const refusal = (change: LogicChange): { name: string; reason: string } | undefined => {
        const reach = guardIndex.find(change.path);
        for (const rule of guards) {
            if (!reach.has(rule)) continue;
            const proposed = new WorkingCopy((path) => host.get(path));
            if (change.value === undefined) proposed.delete(change.path);
            else proposed.set(change.path, change.value);
            for (const match of matchPattern(rule.pattern, change.path, change.value)) {
                const value = proposed.get(match.path);
                const before = host.get(match.path);
                if (deepEqual(value, before)) continue;
                if (value === undefined && removedWithParent(match.path, change, (path) => proposed.get(path))) continue;
                const trigger = value ?? null;
                const scope: Scope = { read: (path) => proposed.get(path), trigger, previous: before ?? null, captures: match.captures, functions };
                let reason: string | undefined;
                try {
                    if (passes(rule.trigger, scope, trigger)) reason = String(resolveValue(rule.reason, scope, host));
                } catch (error) {
                    reason = `guard ${rule.name} failed: ${(error as Error).message}`;
                }
                if (reason === undefined) continue;
                const refused = reason;
                traced('guard', [change.path], () => note({ kind: 'guard', name: rule.name, outcome: 'refused', path: match.path, reason: refused }));
                return { name: rule.name, reason };
            }
        }
        return undefined;
    };
    const guard = (change: LogicChange): string | undefined => refusal(change)?.reason ?? host.guard?.(change);

    /** Runs a transition and commits its writes; returns them as changes, or nothing when it failed */
    const fire = (unit: Unit, hit: Hit, results: Results): LogicChange[] => {
        const copy = new WorkingCopy((path) => host.get(path));
        const scope: Scope = {
            read: (path) => copy.get(path),
            captures: hit.captures,
            ...(hit.trigger === undefined ? {} : { trigger: hit.trigger }),
            ...(hit.previous === undefined ? {} : { previous: hit.previous }),
            ...(hit.result === undefined ? {} : { result: hit.result }),
            functions
        };
        const context: CommandContext = { copy, scope, host, guard, results: [], after: [], calls: [] };
        const from = fromOf(hit.state);
        for (const [index, command] of (hit.transition.do ?? []).entries()) {
            try {
                runCommand(command, context);
            } catch (error) {
                unitFailed(unit, { ...from, command: index, reason: error instanceof LogicError ? error.message : String(error) });
                return [];
            }
        }
        if (unit.machine && hit.transition.to !== undefined && hit.transition.to !== hit.state) {
            copy.set(unit.machine.state, hit.transition.to);
        }
        const before = copy.writes.map((write) => host.get(write.path));
        if (copy.writes.length > 0) {
            try {
                host.commit(copy.writes);
            } catch (error) {
                unitFailed(unit, { ...from, reason: (error as Error).message });
                return [];
            }
        }
        note({
            kind: unit.kind,
            name: unit.name,
            outcome: 'fired',
            ...(hit.path === undefined ? {} : { path: hit.path }),
            ...from,
            ...(unit.machine && hit.transition.to !== undefined && hit.transition.to !== hit.state ? { to: hit.transition.to } : {}),
            writes: copy.writes.slice(0, MAX_TRACE_WRITES).map((write) => write.path)
        });
        for (const notice of context.after) notice();
        for (const { name, result } of context.results) results.push({ unit, name, result });
        if (unit.machine) for (const call of context.calls) ask(unit, call.name, call.payload, call.as);
        return copy.writes.map((write, index) => (before[index] === undefined ? write : { ...write, previous: before[index] }));
    };

    /** Starts a debounce timer for a hit, replacing the one its transition has */
    const debounce = (unit: Unit, hit: Hit, ms: number): void => {
        const key = `${unit.id}#${hit.index}`;
        debounced.get(key)?.();
        const cancel = host.schedule?.(ms, () => {
            debounced.delete(key);
            if (stopped) return;
            const state = stateOf(unit);
            if (hit.transition.from !== undefined && hit.transition.from !== state) return;
            const path = (unit.patterns[hit.index] as PathPattern).source.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => hit.captures[name] ?? whole);
            const trigger = path.includes('*') ? hit.trigger : (host.get(path) ?? null);
            const scope: Scope = { read: (at) => host.get(at), trigger: trigger ?? null, previous: hit.previous ?? null, captures: hit.captures, functions };
            try {
                if (!passes(hit.transition.when, scope, trigger)) return;
                run(unit, { ...hit, ...(state === undefined ? {} : { state }), trigger: trigger ?? null }, 'timer', [path]);
            } catch (error) {
                unitFailed(unit, { ...fromOf(state), reason: (error as Error).message });
            }
        });
        if (cancel) debounced.set(key, cancel);
    };

    const chain = (start: readonly LogicChange[], fired: Set<string>, results: Results): void => {
        let pending = start;
        for (let depth = 0; pending.length > 0; depth += 1) {
            depthNow = depth;
            if (effects) touched.push(...pending);
            if (depth === MAX_CHAIN_DEPTH) {
                failed({ kind: 'chain', name: [...fired].map((id) => id.slice(id.indexOf(':') + 1)).join(', '), reason: `the chain is deeper than ${MAX_CHAIN_DEPTH}` });
                return;
            }
            const next: LogicChange[] = [];
            const reach = reached(pending);
            for (const unit of ordered) {
                const transitions = reach.get(unit.id);
                if (!transitions) continue;
                if (fired.has(unit.id)) {
                    const path = current ? touches(unit, pending) : undefined;
                    if (path !== undefined) note({ kind: unit.kind, name: unit.name, outcome: 'already-fired', path });
                    continue;
                }
                if (unit.declared) {
                    const ran = fireTable(unit, pending);
                    if (ran.ran) fired.add(unit.id);
                    next.push(...ran.changes);
                    continue;
                }
                const hit = findHit(unit, pending, transitions);
                if (!hit) continue;
                fired.add(unit.id);
                if (hit.transition.when.debounce !== undefined) {
                    note({ kind: unit.kind, name: unit.name, outcome: 'debounced', ...(hit.path === undefined ? {} : { path: hit.path }) });
                    debounce(unit, hit, hit.transition.when.debounce);
                } else next.push(...fire(unit, hit, results));
            }
            pending = next;
        }
    };

    const resultHit = (unit: Unit, name: string, result: LogicResult): Hit | undefined => {
        const state = stateOf(unit);
        for (const [index, transition] of unit.transitions.entries()) {
            if (transition.when.result !== name || (transition.from !== undefined && transition.from !== state)) continue;
            const scope: Scope = { read: (path) => host.get(path), result, captures: {}, functions };
            try {
                if (!passes(transition.when, scope, result.status)) continue;
                return { transition, index, ...(state === undefined ? {} : { state }), captures: {}, result };
            } catch (error) {
                unitFailed(unit, { ...fromOf(state), reason: (error as Error).message });
            }
        }
        return undefined;
    };

    /** The rules that wait for a named result, in chain order */
    const listeners = (name: string): Unit[] => ordered.filter((unit) => !unit.machine && unit.transitions.some((transition) => transition.when.result === name));

    /**
     * Gives the named results to the units that wait for them, each as a chain of its own: the result of a machine's
     * command to that machine, the result of a rule's command to every rule that waits for its name
     */
    const drain = (results: Results): void => {
        for (let index = 0; index < results.length && index < MAX_RESULTS; index += 1) {
            const { unit, name, result } = results[index] as Results[number];
            for (const waiting of unit.machine ? [unit] : listeners(name)) {
                const hit = resultHit(waiting, name, result);
                if (!hit) continue;
                chain(fire(waiting, hit, results), new Set([waiting.id]), results);
            }
        }
    };

    /** Re-arms the `after` timers of every machine whose state moved since they were armed */
    const arm = (): void => {
        if (stopped || !host.schedule) return;
        for (const unit of units) {
            if (!unit.machine || !unit.transitions.some((transition) => transition.when.after !== undefined)) continue;
            const state = stateOf(unit);
            const current = armed.get(unit.id);
            if (current && current.state === state) continue;
            for (const cancel of current?.cancels ?? []) cancel();
            const cancels: (() => void)[] = [];
            unit.transitions.forEach((transition, index) => {
                const ms = transition.when.after;
                if (ms === undefined || transition.from !== state) return;
                const cancel = host.schedule?.(ms, () => {
                    if (stopped || stateOf(unit) !== state) return;
                    armed.delete(unit.id);
                    const scope: Scope = { read: (path) => host.get(path), captures: {}, functions };
                    try {
                        if (!passes(transition.when, scope, undefined)) {
                            arm();
                            return;
                        }
                    } catch (error) {
                        unitFailed(unit, { ...fromOf(state), reason: (error as Error).message });
                        return;
                    }
                    run(unit, { transition, index, ...(state === undefined ? {} : { state }), captures: {} }, 'timer', [`after ${ms}ms in ${state ?? '?'}`]);
                });
                if (cancel) cancels.push(cancel);
            });
            armed.set(unit.id, { state, cancels });
        }
    };

    /** Fires one hit as a chain of its own with its results, then re-arms timers */
    const run = (unit: Unit, hit: Hit, cause: LogicTraceRun['cause'], changes: readonly string[]): void => {
        traced(cause, changes, () => {
            const results: Results = [];
            chain(fire(unit, hit, results), new Set([unit.id]), results);
            drain(results);
        });
        arm();
        settle();
    };

    /** Sends a `call` to the host and gives its machine the answer as the named result */
    const ask = (unit: Unit, name: string, payload: JsonValue, as: string): void => {
        const answer = (result: LogicResult): void => {
            if (stopped) return;
            const hit = resultHit(unit, as, result);
            if (!hit) return;
            run(unit, hit, 'answer', [`${name} → ${as}`]);
        };
        if (!host.call) {
            queueMicrotask(() => answer({ status: 'rejected', reason: `no server answers "${name}"` }));
            return;
        }
        host.call(name, payload).then(
            (reply) => answer(reply.status === 'accepted' ? { status: 'accepted', ...(reply.value === undefined ? {} : { value: reply.value }) } : { status: 'rejected', reason: reply.reason ?? `"${name}" was rejected` }),
            (error: unknown) => answer({ status: 'rejected', reason: error instanceof Error ? error.message : String(error) })
        );
    };

    /** The start pass of `LogicEngine.derive` */
    const derive = (): void => {
        const units = ordered.filter(derivesOnly);
        if (units.length === 0) return;
        traced(
            'start',
            units.map((unit) => unit.name),
            () => {
                for (const unit of units) {
                    if (unit.declared) {
                        fireTable(unit, [], true);
                        continue;
                    }
                    // one firing per concrete path, so a rule over `$.data.products.{id}.price` derives every record
                    const paths = new Set<string>();
                    for (const change of startChanges(unit)) {
                        for (const pattern of unit.patterns) {
                            if (pattern) for (const match of matchPattern(pattern, change.path, host.get(change.path))) paths.add(match.path);
                        }
                    }
                    for (const path of paths) {
                        const hit = findHit(unit, [{ path }]);
                        if (hit) fire(unit, hit, []);
                    }
                }
            }
        );
    };

    const kinds = (test: (unit: Unit) => boolean): string[] => units.filter(test).map((unit) => unit.name);
    return {
        names: [
            ...kinds((unit) => unit.machine !== undefined),
            ...kinds((unit) => !unit.machine && !unit.declared),
            ...kinds((unit) => unit.declared?.table !== undefined),
            ...kinds((unit) => unit.declared?.compute !== undefined),
            ...effectNames,
            ...guards.map((rule) => rule.name)
        ],
        start(options = {}) {
            const writes = units.flatMap((unit) =>
                unit.machine && host.get(unit.machine.state) === undefined ? [{ path: unit.machine.state, value: unit.machine.initial }] : []
            );
            if (writes.length > 0) {
                try {
                    host.commit(writes);
                } catch (error) {
                    failed({ kind: 'machine', name: kinds((unit) => unit.machine !== undefined).join(', '), reason: (error as Error).message });
                }
            }
            if (options.derive !== false) derive();
            arm();
            settle();
        },
        derive,
        changes(changes) {
            traced(
                'change',
                changes.map((change) => change.path),
                () => {
                    const results: Results = [];
                    chain(changes, new Set(), results);
                    drain(results);
                }
            );
            arm();
            settle();
        },
        guard,
        refusal,
        trace: () => JSON.parse(JSON.stringify(runs)) as LogicTraceRun[],
        clearTrace() {
            runs.length = 0;
        },
        effects: () => effects?.info() ?? [],
        stop() {
            stopped = true;
            effects?.stop();
            for (const cancel of debounced.values()) cancel();
            for (const { cancels } of armed.values()) for (const cancel of cancels) cancel();
            debounced.clear();
            armed.clear();
        }
    };
}
