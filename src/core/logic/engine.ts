import type { JsonValue } from '../types.js';
import { runCommand } from './commands.js';
import type { CommandContext } from './commands.js';
import { compilePattern, matchPattern } from './pattern.js';
import type { PathPattern } from './pattern.js';
import { LogicError, condition, resolveValue } from './values.js';
import type { Scope } from './values.js';
import { WorkingCopy } from './working.js';
import { MAX_CHAIN_DEPTH } from './types.js';
import type {
    LogicChange,
    LogicCommand,
    LogicDocument,
    LogicFailure,
    LogicHost,
    LogicMachine,
    LogicResult,
    LogicTransition,
    LogicWrite
} from './types.js';

/** The most results one call follows, so results that keep producing results end */
const MAX_RESULTS = 64;

/** A machine, or a rule as a machine with one state and one transition */
interface Unit {
    id: string;
    name: string;
    machine?: LogicMachine;
    transitions: LogicTransition[];
    patterns: (PathPattern | undefined)[];
}

interface Hit {
    transition: LogicTransition;
    state?: string;
    trigger?: JsonValue;
    captures: Record<string, string>;
    result?: LogicResult;
}

interface Guard {
    name: string;
    pattern: PathPattern;
    trigger: LogicTransition['when'];
    reason: string;
}

export interface LogicEngine {
    /** The machine and rule names, machines first */
    readonly names: readonly string[];
    /** Writes each machine's `initial` state where its state path has no value, in one commit */
    start(): void;
    /** Looks up changes the host has applied and runs the transitions they trigger, their chains and results */
    changes(changes: readonly LogicChange[]): void;
    /** The reason a guard rule refuses a proposed change, or undefined when none does */
    guard(change: LogicChange): string | undefined;
}

function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function isGuard(commands: readonly LogicCommand[]): boolean {
    return commands.length === 1 && commands[0]?.command === 'reject';
}

/**
 * The logic runner over a host: a browser store or an app server's authority.
 *
 * A change is looked up against every machine and rule, machines first, each in document order. A machine considers
 * only the transitions of its current state (or with no `from`) and fires the first that matches; a rule is one
 * transition. The commands of a transition run against a working copy and commit together; a failing command commits
 * nothing and reports a failure. The writes of a commit are looked up again as a chain: a machine or rule fires at
 * most once per chain, and a chain stops past `MAX_CHAIN_DEPTH`. Named results (`as`) are given to their machine after
 * the chain, each starting a chain of its own. A rule whose commands are one `reject` is a guard and never fires; the
 * host asks `guard` before it applies a change
 */
export function createLogicEngine(logic: LogicDocument, host: LogicHost): LogicEngine {
    const units: Unit[] = [];
    const guards: Guard[] = [];
    const failed = (failure: LogicFailure): void => host.failed?.(failure);

    for (const [name, machine] of Object.entries(logic.machines ?? {})) {
        units.push({
            id: `machine:${name}`,
            name,
            machine,
            transitions: machine.transitions,
            patterns: machine.transitions.map((transition) =>
                transition.when.path === undefined ? undefined : compilePattern(transition.when.path)
            )
        });
    }
    for (const [name, rule] of Object.entries(logic.rules ?? {})) {
        const pattern = rule.when.path === undefined ? undefined : compilePattern(rule.when.path);
        if (isGuard(rule.do)) {
            if (pattern) guards.push({ name, pattern, trigger: rule.when, reason: rule.do[0]?.reason ?? `refused by ${name}` });
            continue;
        }
        units.push({ id: `rule:${name}`, name, transitions: [{ when: rule.when, do: rule.do }], patterns: [pattern] });
    }

    const stateOf = (unit: Unit): string | undefined => {
        if (!unit.machine) return undefined;
        const value = host.get(unit.machine.state);
        return typeof value === 'string' ? value : unit.machine.initial;
    };

    const passes = (when: LogicTransition['when'], scope: Scope, compared: JsonValue | undefined): boolean => {
        if (Object.hasOwn(when, 'is') && !deepEqual(compared, when.is)) return false;
        return when.if === undefined || condition(when.if, scope);
    };

    /** The first transition of the unit's current state that one of the changes triggers */
    const findHit = (unit: Unit, changes: readonly LogicChange[]): Hit | undefined => {
        const state = stateOf(unit);
        for (const [index, transition] of unit.transitions.entries()) {
            const pattern = unit.patterns[index];
            if (!pattern || (transition.from !== undefined && transition.from !== state)) continue;
            for (const change of changes) {
                for (const match of matchPattern(pattern, change.path, host.get(change.path))) {
                    const trigger = host.get(match.path);
                    const scope: Scope = { read: (path) => host.get(path), trigger: trigger ?? null, captures: match.captures };
                    try {
                        if (passes(transition.when, scope, trigger)) {
                            return { transition, ...(state === undefined ? {} : { state }), trigger: trigger ?? null, captures: match.captures };
                        }
                    } catch (error) {
                        failed({ machine: unit.name, ...(state === undefined ? {} : { from: state }), reason: (error as Error).message });
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
                const scope: Scope = { read: (path) => proposed.get(path), trigger, captures: match.captures };
                try {
                    if (passes(rule.trigger, scope, trigger)) return String(resolveValue(rule.reason, scope, host));
                } catch (error) {
                    return `guard ${rule.name} failed: ${(error as Error).message}`;
                }
            }
        }
        return undefined;
    };

    /** Runs a transition and commits its writes; returns them, or nothing when it failed */
    const fire = (unit: Unit, hit: Hit, results: { unit: Unit; name: string; result: LogicResult }[]): LogicWrite[] => {
        const copy = new WorkingCopy((path) => host.get(path));
        const scope: Scope = {
            read: (path) => copy.get(path),
            captures: hit.captures,
            ...(hit.trigger === undefined ? {} : { trigger: hit.trigger }),
            ...(hit.result === undefined ? {} : { result: hit.result })
        };
        const context: CommandContext = { copy, scope, host, guard, results: [], after: [] };
        const from = hit.state === undefined ? {} : { from: hit.state };
        for (const [index, command] of (hit.transition.do ?? []).entries()) {
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
        if (copy.writes.length > 0) {
            try {
                host.commit(copy.writes);
            } catch (error) {
                failed({ machine: unit.name, ...from, reason: (error as Error).message });
                return [];
            }
        }
        for (const notice of context.after) notice();
        if (unit.machine) for (const { name, result } of context.results) results.push({ unit, name, result });
        return copy.writes;
    };

    const chain = (start: readonly LogicChange[], fired: Set<string>, results: { unit: Unit; name: string; result: LogicResult }[]): void => {
        let pending = start;
        for (let depth = 0; pending.length > 0; depth += 1) {
            if (depth === MAX_CHAIN_DEPTH) {
                failed({ machine: [...fired].map((id) => id.slice(id.indexOf(':') + 1)).join(', '), reason: `the chain is deeper than ${MAX_CHAIN_DEPTH}` });
                return;
            }
            const next: LogicWrite[] = [];
            for (const unit of units) {
                if (fired.has(unit.id)) continue;
                const hit = findHit(unit, pending);
                if (!hit) continue;
                fired.add(unit.id);
                next.push(...fire(unit, hit, results));
            }
            pending = next;
        }
    };

    const resultHit = (unit: Unit, name: string, result: LogicResult): Hit | undefined => {
        const state = stateOf(unit);
        for (const transition of unit.transitions) {
            if (transition.when.result !== name || (transition.from !== undefined && transition.from !== state)) continue;
            const scope: Scope = { read: (path) => host.get(path), result, captures: {} };
            try {
                if (passes(transition.when, scope, result.status)) {
                    return { transition, ...(state === undefined ? {} : { state }), captures: {}, result };
                }
            } catch (error) {
                failed({ machine: unit.name, ...(state === undefined ? {} : { from: state }), reason: (error as Error).message });
            }
        }
        return undefined;
    };

    return {
        names: units.filter((unit) => unit.machine).map((unit) => unit.name).concat(units.filter((unit) => !unit.machine).map((unit) => unit.name), guards.map((rule) => rule.name)),
        start() {
            const writes: LogicWrite[] = [];
            for (const unit of units) {
                if (unit.machine && host.get(unit.machine.state) === undefined) {
                    writes.push({ path: unit.machine.state, value: unit.machine.initial });
                }
            }
            if (writes.length === 0) return;
            try {
                host.commit(writes);
            } catch (error) {
                failed({ machine: units.filter((unit) => unit.machine).map((unit) => unit.name).join(', '), reason: (error as Error).message });
            }
        },
        changes(changes) {
            const results: { unit: Unit; name: string; result: LogicResult }[] = [];
            chain(changes, new Set(), results);
            for (let index = 0; index < results.length && index < MAX_RESULTS; index += 1) {
                const { unit, name, result } = results[index] as { unit: Unit; name: string; result: LogicResult };
                const hit = resultHit(unit, name, result);
                if (!hit) continue;
                const fired = new Set([unit.id]);
                chain(fire(unit, hit, results), fired, results);
            }
        },
        guard
    };
}
