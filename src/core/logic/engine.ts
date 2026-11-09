import type { JsonValue } from '../types.js';
import { runCommand } from './commands.js';
import type { CommandContext } from './commands.js';
import { PathIndex } from './pathIndex.js';
import { compilePattern, matchPattern, pathSteps } from './pattern.js';
import type { PathPattern, PatternMatch } from './pattern.js';
import { LogicError, condition, resolveValue } from './values.js';
import type { Scope } from './values.js';
import { WorkingCopy, covers, placed, within } from './working.js';
import { MAX_CHAIN_DEPTH } from './types.js';
import { ROUTE_PATH } from '../route/index.js';
import type {
    LogicChange,
    LogicCommand,
    LogicDocument,
    LogicFailure,
    LogicHost,
    LogicMachine,
    LogicResult,
    LogicRow,
    LogicTable,
    LogicTraceEvent,
    LogicTraceRun,
    LogicTransition,
    LogicUnitKind
} from './types.js';

/** The most results one call follows, so results that keep producing results end */
const MAX_RESULTS = 64;

/** The runs the trace keeps, the events it keeps of one run, and the write paths it keeps of one event */
const MAX_TRACE_RUNS = 25;
const MAX_TRACE_EVENTS = 200;
const MAX_TRACE_WRITES = 20;

/** A machine, a rule as a machine with one state and one transition, or a table as a rule with rows */
interface Unit {
    id: string;
    kind: Exclude<LogicUnitKind, 'guard' | 'chain'>;
    name: string;
    machine?: LogicMachine;
    table?: LogicTable;
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
    /** The commands of the table row that matched, instead of the transition's */
    row?: LogicRow;
    inputs?: Record<string, JsonValue>;
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
     * Runs each rule and table that only derives values (path triggers without `was`; only `set`, `merge`, `copy` and
     * `query`) once, in chain order, as if the data at its trigger paths had just arrived, so derived values are right
     * before the first change. Rules that act (`notify`, `navigate`, data commands, `toggle`...) and machines wait
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
    /** Cancels every timer and ignores call answers that arrive later */
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

/**
 * The steps of the paths a unit's commands can write, with `null` for a step that is only known when it runs (a
 * capture, `*` or a `{{ }}` template). Node references (`^name`) resolve at run time and are left out
 */
function writeSteps(unit: { machine?: LogicMachine; transitions: readonly LogicTransition[]; table?: LogicTable }): (string | null)[][] {
    return writePaths(unit).map((path) => path.replace(/\{\{[\s\S]*?\}\}/g, '{}').slice(2).split('.').map((step) => (step === '*' || step.includes('{') ? null : step)));
}

/** The commands of a unit: its transitions' and its table rows' */
function unitCommands(unit: { transitions: readonly LogicTransition[]; table?: LogicTable }): LogicCommand[] {
    return [...unit.transitions.flatMap((transition) => transition.do ?? []), ...(unit.table?.rows.flatMap((row) => row.do) ?? [])];
}

/** The state paths a unit's commands can write, and its machine's state path, as written (`$.data.bag.{id}.total`) */
function writePaths(unit: { machine?: LogicMachine; transitions: readonly LogicTransition[]; table?: LogicTable }): string[] {
    const paths = unitCommands(unit).flatMap((command) => {
        if (command.command === 'navigate') return [ROUTE_PATH];
        return NOT_WRITES.has(command.command) ? [] : WRITE_KEYS.flatMap((key) => (typeof command[key] === 'string' ? [command[key] as string] : []));
    });
    if (unit.machine) paths.push(unit.machine.state);
    return paths.filter((path) => path.startsWith('$.'));
}

/** True when a write at `steps` can change a value at, below or above the pattern's path */
function mayTouch(pattern: PathPattern, steps: readonly (string | null)[]): boolean {
    const shared = Math.min(pattern.steps.length, steps.length);
    for (let index = 0; index < shared; index += 1) {
        const step = pattern.steps[index] as PathPattern['steps'][number];
        const key = steps[index];
        if (step.kind === 'literal' && key !== null && key !== step.text) return false;
    }
    return true;
}

/**
 * The units in the order a chain looks them up: document order (machines, rules, tables), except that a unit comes
 * after the other units whose commands can write under its trigger paths, so a rule over `$.data.bag` that sums line
 * totals sees the totals a table writes in the same step. Units that depend on each other in a cycle keep document order
 */
function chainOrder<T extends { id: string; machine?: LogicMachine; table?: LogicTable; transitions: readonly LogicTransition[]; patterns: readonly (PathPattern | undefined)[] }>(units: readonly T[]): T[] {
    const writes = new Map(units.map((unit) => [unit.id, writeSteps(unit)]));
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

/** The units and guards of a logic document, in document order (machines, rules, tables) */
function buildUnits(logic: LogicDocument): { units: Unit[]; guards: Guard[] } {
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
        units.push({ id: `table:${name}`, kind: 'table', name, table, transitions: [{ when: table.when }], patterns: [pattern(table.when)] });
    }
    return { units, guards };
}

/** Where a unit runs in a logic document, and the state paths it reads and writes */
export interface LogicUnitPlace {
    readonly kind: 'machine' | 'rule' | 'table' | 'guard';
    readonly name: string;
    /** 1-based place in the order a chain looks units up; absent for a guard, which is asked before a change commits */
    readonly position?: number;
    /** Trigger paths, table input paths and `from` paths of commands */
    readonly reads: readonly string[];
    /** The paths its commands write, and a machine's state path */
    readonly writes: readonly string[];
}

/** The `$.` paths among the values of a unit's triggers, table inputs and command `from` keys */
function readPaths(unit: { transitions: readonly LogicTransition[]; table?: LogicTable }): string[] {
    const paths = [
        ...unit.transitions.map((transition) => transition.when.path),
        ...Object.values(unit.table?.inputs ?? {}),
        ...unitCommands(unit).map((command) => command['from'])
    ];
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
 * True for a rule or table that only derives values: every trigger is a `path` with no `was` (which needs a change),
 * and every command, of its transitions and its table rows, is `set`, `merge`, `copy` or `query`. A machine never is
 */
function derivesOnly(unit: Unit): boolean {
    if (unit.machine) return false;
    if (unit.transitions.some((transition) => transition.when.path === undefined || transition.when.was !== undefined || transition.when.after !== undefined)) return false;
    const commands = [...unit.transitions.flatMap((transition) => transition.do ?? []), ...(unit.table?.rows.flatMap((row) => row.do) ?? [])];
    return commands.every((command) => DERIVE_COMMANDS.has(command.command));
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
 * is one transition; a table fires the first of its rows that matches its inputs. The commands of a transition run
 * against a working copy and commit together; a failing command commits nothing and reports a failure. The writes of
 * a commit are looked up again as a chain: a machine, rule or table fires at most once per chain, and a chain stops
 * past `MAX_CHAIN_DEPTH`. Named results (`as`) are given after the chain, each starting a chain of its own: a machine's
 * to that machine, a rule's or table's to every rule and table whose `when.result` names it; a `call`'s result comes when the host answers it. A rule whose commands are one `reject` is a guard and never
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

    const built = buildUnits(logic);
    units.push(...built.units);
    guards.push(...built.guards);

    const ordered = chainOrder(units);

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

    /** The first row of a table that the inputs match, with the inputs; undefined when none does */
    const tableRow = (table: LogicTable, scope: Scope): { row: LogicRow; inputs: Record<string, JsonValue> } | undefined => {
        const inputs: Record<string, JsonValue> = {};
        for (const [name, value] of Object.entries(table.inputs ?? {})) inputs[name] = resolveValue(value, scope, host);
        const withInputs: Scope = { ...scope, inputs };
        for (const row of table.rows) {
            if (Object.entries(row.match ?? {}).some(([name, value]) => !deepEqual(inputs[name], value))) continue;
            if (row.if !== undefined && !condition(row.if, withInputs)) continue;
            return { row, inputs };
        }
        return undefined;
    };

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
                        captures: match.captures
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
                        if (!unit.table) return hit;
                        const found = tableRow(unit.table, scope);
                        if (found) return { ...hit, ...found };
                        missed('condition', match.path, 'no row matched');
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
                const scope: Scope = { read: (path) => proposed.get(path), trigger, previous: before ?? null, captures: match.captures };
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
            ...(hit.inputs === undefined ? {} : { inputs: hit.inputs })
        };
        const context: CommandContext = { copy, scope, host, guard, results: [], after: [], calls: [] };
        const from = fromOf(hit.state);
        for (const [index, command] of ((hit.row ?? hit.transition).do ?? []).entries()) {
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
        const row = hit.row && unit.table ? unit.table.rows.indexOf(hit.row) : -1;
        note({
            kind: unit.kind,
            name: unit.name,
            outcome: 'fired',
            ...(hit.path === undefined ? {} : { path: hit.path }),
            ...from,
            ...(unit.machine && hit.transition.to !== undefined && hit.transition.to !== hit.state ? { to: hit.transition.to } : {}),
            ...(row < 0 ? {} : { row }),
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
            const scope: Scope = { read: (at) => host.get(at), trigger: trigger ?? null, previous: hit.previous ?? null, captures: hit.captures };
            try {
                if (!passes(hit.transition.when, scope, trigger)) return;
                let fresh: Hit = { ...hit, ...(state === undefined ? {} : { state }), trigger: trigger ?? null };
                if (unit.table) {
                    const found = tableRow(unit.table, scope);
                    if (!found) return;
                    fresh = { ...fresh, ...found };
                }
                run(unit, fresh, 'timer', [path]);
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
            const scope: Scope = { read: (path) => host.get(path), result, captures: {} };
            try {
                if (!passes(transition.when, scope, result.status)) continue;
                const hit: Hit = { transition, index, ...(state === undefined ? {} : { state }), captures: {}, result };
                if (!unit.table) return hit;
                const found = tableRow(unit.table, scope);
                if (found) return { ...hit, ...found };
            } catch (error) {
                unitFailed(unit, { ...fromOf(state), reason: (error as Error).message });
            }
        }
        return undefined;
    };

    /** The rules and tables that wait for a named result, in chain order */
    const listeners = (name: string): Unit[] => ordered.filter((unit) => !unit.machine && unit.transitions.some((transition) => transition.when.result === name));

    /**
     * Gives the named results to the units that wait for them, each as a chain of its own: the result of a machine's
     * command to that machine, the result of a rule's or table's command to every rule and table that waits for its name
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
                    const scope: Scope = { read: (path) => host.get(path), captures: {} };
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
            ...kinds((unit) => !unit.machine && !unit.table),
            ...kinds((unit) => unit.table !== undefined),
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
        },
        guard,
        refusal,
        trace: () => JSON.parse(JSON.stringify(runs)) as LogicTraceRun[],
        clearTrace() {
            runs.length = 0;
        },
        stop() {
            stopped = true;
            for (const cancel of debounced.values()) cancel();
            for (const { cancels } of armed.values()) for (const cancel of cancels) cancel();
            debounced.clear();
            armed.clear();
        }
    };
}
