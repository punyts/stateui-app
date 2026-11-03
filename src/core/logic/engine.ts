import type { JsonValue } from '../types.js';
import { runCommand } from './commands.js';
import type { CommandContext } from './commands.js';
import { compilePattern, matchPattern, pathSteps } from './pattern.js';
import type { PathPattern } from './pattern.js';
import { LogicError, condition, resolveValue } from './values.js';
import type { Scope } from './values.js';
import { WorkingCopy, covers, placed, within } from './working.js';
import { MAX_CHAIN_DEPTH } from './types.js';
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
    LogicTransition
} from './types.js';

/** The most results one call follows, so results that keep producing results end */
const MAX_RESULTS = 64;

/** A machine, a rule as a machine with one state and one transition, or a table as a rule with rows */
interface Unit {
    id: string;
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
    /** Writes each machine's `initial` state where its state path has no value, in one commit, and arms `after` timers */
    start(): void;
    /** Looks up changes the host has applied and runs the transitions they trigger, their chains and results */
    changes(changes: readonly LogicChange[]): void;
    /** The reason a guard rule refuses a proposed change, or undefined when none does */
    guard(change: LogicChange): string | undefined;
    /** Cancels every timer and ignores call answers that arrive later */
    stop(): void;
}

function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function isGuard(commands: readonly LogicCommand[]): boolean {
    return commands.length === 1 && commands[0]?.command === 'reject';
}

/** The value at `at` before a change: taken from the change's previous value, laid into the current value when the change was below */
function previousAt(at: string, change: LogicChange, current: JsonValue | undefined): JsonValue | undefined {
    if (at === change.path) return change.previous;
    if (covers(change.path, at)) return within(change.previous, pathSteps(at).slice(pathSteps(change.path).length));
    return placed(current, pathSteps(change.path).slice(pathSteps(at).length), change.previous);
}

/**
 * The logic runner over a host: a browser store or an app server's authority.
 *
 * A change is looked up against every machine, rule and table, in that order and each in document order. A machine
 * considers only the transitions of its current state (or with no `from`) and fires the first that matches; a rule
 * is one transition; a table fires the first of its rows that matches its inputs. The commands of a transition run
 * against a working copy and commit together; a failing command commits nothing and reports a failure. The writes of
 * a commit are looked up again as a chain: a machine, rule or table fires at most once per chain, and a chain stops
 * past `MAX_CHAIN_DEPTH`. Named results (`as`) are given to their machine after the chain, each starting a chain of its
 * own; a `call`'s result comes when the host answers it. A rule whose commands are one `reject` is a guard and never
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

    const pattern = (when: LogicTransition['when']): PathPattern | undefined => (when.path === undefined ? undefined : compilePattern(when.path));
    for (const [name, machine] of Object.entries(logic.machines ?? {})) {
        units.push({ id: `machine:${name}`, name, machine, transitions: machine.transitions, patterns: machine.transitions.map((transition) => pattern(transition.when)) });
    }
    for (const [name, rule] of Object.entries(logic.rules ?? {})) {
        const compiled = pattern(rule.when);
        if (isGuard(rule.do)) {
            if (compiled) guards.push({ name, pattern: compiled, trigger: rule.when, reason: rule.do[0]?.reason ?? `refused by ${name}` });
            continue;
        }
        units.push({ id: `rule:${name}`, name, transitions: [{ when: rule.when, do: rule.do }], patterns: [compiled] });
    }
    for (const [name, table] of Object.entries(logic.tables ?? {})) {
        units.push({ id: `table:${name}`, name, table, transitions: [{ when: table.when }], patterns: [pattern(table.when)] });
    }

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

    /** The first transition of the unit's current state that one of the changes triggers */
    const findHit = (unit: Unit, changes: readonly LogicChange[]): Hit | undefined => {
        const state = stateOf(unit);
        for (const [index, transition] of unit.transitions.entries()) {
            const compiled = unit.patterns[index];
            if (!compiled || (transition.from !== undefined && transition.from !== state)) continue;
            for (const change of changes) {
                for (const match of matchPattern(compiled, change.path, host.get(change.path))) {
                    const trigger = host.get(match.path);
                    const previous = previousAt(match.path, change, trigger);
                    const scope: Scope = {
                        read: (path) => host.get(path),
                        trigger: trigger ?? null,
                        previous: previous ?? null,
                        captures: match.captures
                    };
                    try {
                        if (!passes(transition.when, scope, trigger)) continue;
                        const hit: Hit = { transition, index, ...(state === undefined ? {} : { state }), trigger: trigger ?? null, previous: previous ?? null, captures: match.captures };
                        if (!unit.table) return hit;
                        const found = tableRow(unit.table, scope);
                        if (found) return { ...hit, ...found };
                    } catch (error) {
                        failed({ machine: unit.name, ...fromOf(state), reason: (error as Error).message });
                    }
                }
            }
        }
        return undefined;
    };

    const guard = (change: LogicChange): string | undefined => {
        for (const rule of guards) {
            const proposed = new WorkingCopy((path) => host.get(path));
            if (change.value === undefined) proposed.delete(change.path);
            else proposed.set(change.path, change.value);
            for (const match of matchPattern(rule.pattern, change.path, change.value)) {
                const trigger = proposed.get(match.path) ?? null;
                const scope: Scope = { read: (path) => proposed.get(path), trigger, previous: host.get(match.path) ?? null, captures: match.captures };
                try {
                    if (passes(rule.trigger, scope, trigger)) return String(resolveValue(rule.reason, scope, host));
                } catch (error) {
                    return `guard ${rule.name} failed: ${(error as Error).message}`;
                }
            }
        }
        return undefined;
    };

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
                failed({ machine: unit.name, ...from, command: index, reason: error instanceof LogicError ? error.message : String(error) });
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
                failed({ machine: unit.name, ...from, reason: (error as Error).message });
                return [];
            }
        }
        for (const notice of context.after) notice();
        if (unit.machine) {
            for (const { name, result } of context.results) results.push({ unit, name, result });
            for (const call of context.calls) ask(unit, call.name, call.payload, call.as);
        }
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
                let current: Hit = { ...hit, ...(state === undefined ? {} : { state }), trigger: trigger ?? null };
                if (unit.table) {
                    const found = tableRow(unit.table, scope);
                    if (!found) return;
                    current = { ...current, ...found };
                }
                run(unit, current);
            } catch (error) {
                failed({ machine: unit.name, ...fromOf(state), reason: (error as Error).message });
            }
        });
        if (cancel) debounced.set(key, cancel);
    };

    const chain = (start: readonly LogicChange[], fired: Set<string>, results: Results): void => {
        let pending = start;
        for (let depth = 0; pending.length > 0; depth += 1) {
            if (depth === MAX_CHAIN_DEPTH) {
                failed({ machine: [...fired].map((id) => id.slice(id.indexOf(':') + 1)).join(', '), reason: `the chain is deeper than ${MAX_CHAIN_DEPTH}` });
                return;
            }
            const next: LogicChange[] = [];
            for (const unit of units) {
                if (fired.has(unit.id)) continue;
                const hit = findHit(unit, pending);
                if (!hit) continue;
                fired.add(unit.id);
                if (hit.transition.when.debounce !== undefined) debounce(unit, hit, hit.transition.when.debounce);
                else next.push(...fire(unit, hit, results));
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
                if (passes(transition.when, scope, result.status)) {
                    return { transition, index, ...(state === undefined ? {} : { state }), captures: {}, result };
                }
            } catch (error) {
                failed({ machine: unit.name, ...fromOf(state), reason: (error as Error).message });
            }
        }
        return undefined;
    };

    /** Gives the named results to their machines, each as a chain of its own */
    const drain = (results: Results): void => {
        for (let index = 0; index < results.length && index < MAX_RESULTS; index += 1) {
            const { unit, name, result } = results[index] as Results[number];
            const hit = resultHit(unit, name, result);
            if (!hit) continue;
            chain(fire(unit, hit, results), new Set([unit.id]), results);
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
                        failed({ machine: unit.name, ...fromOf(state), reason: (error as Error).message });
                        return;
                    }
                    run(unit, { transition, index, ...(state === undefined ? {} : { state }), captures: {} });
                });
                if (cancel) cancels.push(cancel);
            });
            armed.set(unit.id, { state, cancels });
        }
    };

    /** Fires one hit as a chain of its own with its results, then re-arms timers */
    const run = (unit: Unit, hit: Hit): void => {
        const results: Results = [];
        chain(fire(unit, hit, results), new Set([unit.id]), results);
        drain(results);
        arm();
    };

    /** Sends a `call` to the host and gives its machine the answer as the named result */
    const ask = (unit: Unit, name: string, payload: JsonValue, as: string): void => {
        const answer = (result: LogicResult): void => {
            if (stopped) return;
            const hit = resultHit(unit, as, result);
            if (!hit) return;
            run(unit, hit);
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

    const kinds = (test: (unit: Unit) => boolean): string[] => units.filter(test).map((unit) => unit.name);
    return {
        names: [
            ...kinds((unit) => unit.machine !== undefined),
            ...kinds((unit) => !unit.machine && !unit.table),
            ...kinds((unit) => unit.table !== undefined),
            ...guards.map((rule) => rule.name)
        ],
        start() {
            const writes = units.flatMap((unit) =>
                unit.machine && host.get(unit.machine.state) === undefined ? [{ path: unit.machine.state, value: unit.machine.initial }] : []
            );
            if (writes.length > 0) {
                try {
                    host.commit(writes);
                } catch (error) {
                    failed({ machine: kinds((unit) => unit.machine !== undefined).join(', '), reason: (error as Error).message });
                }
            }
            arm();
        },
        changes(changes) {
            const results: Results = [];
            chain(changes, new Set(), results);
            drain(results);
            arm();
        },
        guard,
        stop() {
            stopped = true;
            for (const cancel of debounced.values()) cancel();
            for (const { cancels } of armed.values()) for (const cancel of cancels) cancel();
            debounced.clear();
            armed.clear();
        }
    };
}
