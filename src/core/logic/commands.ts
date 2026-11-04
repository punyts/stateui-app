import { isObject } from '../resolve/merge.js';
import { ROUTE_PATH, isRouteRefusal, routeTo } from '../route/index.js';
import type { JsonObject, JsonValue } from '../types.js';
import { LogicError, condition, resolvePath, resolveValue } from './values.js';
import type { Scope } from './values.js';
import type { WorkingCopy } from './working.js';
import type { LogicCommand, LogicHost, LogicResult, LogicWrite } from './types.js';

const INTEGER_KEY = /^(0|[1-9][0-9]*)$/;
const KEY = /^[^.\s]+$/;

/** What a command works on while its transition runs */
export interface CommandContext {
    copy: WorkingCopy;
    scope: Scope;
    host: LogicHost;
    /** The reason a guard refuses a write, or undefined */
    guard(write: LogicWrite): string | undefined;
    /** Named results, given after the transition commits to its machine, or to the rules and tables that wait for them */
    results: { name: string; result: LogicResult }[];
    /** Events to raise after the transition commits */
    after: (() => void)[];
    /** Server procedures to call after the transition commits, each answered as the named result `as` */
    calls: { name: string; payload: JsonValue; as: string }[];
}

function required(command: LogicCommand, key: 'target' | 'from' | 'into'): string {
    const value = command[key];
    if (typeof value !== 'string' || value === '') throw new LogicError(`"${command.command}" needs "${key}"`);
    return value;
}

function value(command: LogicCommand, context: CommandContext): JsonValue {
    return command.value === undefined ? null : resolveValue(command.value, context.scope, context.host);
}

function path(command: LogicCommand, key: 'target' | 'from' | 'into', context: CommandContext): string {
    return resolvePath(required(command, key), context.scope, context.host);
}

/**
 * A write target below `$.data.<root>` needs its parent: a set through a missing parent would make a stub record (for
 * example below a record another command just removed). `merge` and `save-data` create what is missing
 */
function writable(target: string, context: CommandContext): string {
    if (!target.startsWith('$.data.')) return target;
    const steps = target.slice(2).split('.');
    if (steps.length <= 2) return target;
    const parent = `$.${steps.slice(0, -1).join('.')}`;
    if (context.copy.get(parent) === undefined) {
        throw new LogicError(`${parent} does not exist, so ${target} cannot be written; write the parent first, or use merge or save-data, which create it`);
    }
    return target;
}

function deepEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function defaultKey(): string {
    const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 10);
    return `r${Date.now().toString(36)}${random ?? Math.random().toString(36).slice(2, 12)}`;
}

function checkKey(key: string): string {
    if (!KEY.test(key) || INTEGER_KEY.test(key)) throw new LogicError(`"${key}" is not a record key; keys must not be integer-like or contain dots`);
    return key;
}

/** Writes the document's values over what changed below `at`; never deletes, so a node keeps its place */
function resetWrites(at: string, current: JsonValue | undefined, initial: JsonValue | undefined, writes: LogicWrite[]): void {
    if (initial === undefined || deepEqual(current, initial)) return;
    if (isObject(current) && isObject(initial)) {
        for (const [key, item] of Object.entries(initial)) resetWrites(`${at}.${key}`, current[key], item, writes);
        return;
    }
    writes.push({ path: at, value: initial });
}

function outcome(context: CommandContext, command: LogicCommand, result: LogicResult): void {
    if (command.as !== undefined) {
        context.results.push({ name: command.as, result });
        return;
    }
    if (result.status === 'rejected') throw new LogicError(result.reason ?? `"${command.command}" was rejected`);
}

/** `sort`: a field name (`name`, `-name` for descending), or `{ by, direction }` */
function readSort(sort: JsonValue): { by: string; descending: boolean } | undefined {
    if (typeof sort === 'string' && sort !== '') {
        return sort.startsWith('-') ? { by: sort.slice(1), descending: true } : { by: sort, descending: false };
    }
    if (isObject(sort) && typeof sort['by'] === 'string' && sort['by'] !== '') {
        return { by: sort['by'], descending: sort['direction'] === 'desc' };
    }
    return undefined;
}

function compare(a: JsonValue | undefined, b: JsonValue | undefined): number {
    if (a === b) return 0;
    if (a === undefined || a === null) return 1;
    if (b === undefined || b === null) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function readWindow(window: JsonValue, total: number): { first: number; count: number } {
    const first = isObject(window) && typeof window['first'] === 'number' ? Math.max(0, Math.floor(window['first'])) : 0;
    const count = isObject(window) && typeof window['count'] === 'number' ? Math.max(0, Math.floor(window['count'])) : total;
    return { first, count };
}

type Runner = (command: LogicCommand, context: CommandContext) => void;

const RUNNERS: Record<LogicCommand['command'], Runner> = {
    set: (command, context) => {
        context.copy.set(writable(path(command, 'target', context), context), value(command, context));
    },
    merge: (command, context) => {
        const target = path(command, 'target', context);
        const patch = value(command, context);
        if (!isObject(patch)) throw new LogicError('"merge" needs an object value');
        if (!isObject(context.copy.get(target) ?? {})) throw new LogicError(`${target} is not an object`);
        for (const [key, item] of Object.entries(patch)) context.copy.set(`${target}.${checkKey(key)}`, item);
    },
    copy: (command, context) => {
        const source = context.copy.get(path(command, 'from', context));
        if (source === undefined) throw new LogicError(`${command.from} has no value`);
        context.copy.set(writable(path(command, 'target', context), context), source);
    },
    toggle: (command, context) => {
        const target = writable(path(command, 'target', context), context);
        context.copy.set(target, context.copy.get(target) !== true);
    },
    increment: (command, context) => {
        const target = writable(path(command, 'target', context), context);
        const step = command.value === undefined ? 1 : value(command, context);
        const current = context.copy.get(target) ?? 0;
        if (typeof step !== 'number' || typeof current !== 'number') throw new LogicError('"increment" needs numbers');
        context.copy.set(target, current + step);
    },
    reset: (command, context) => {
        const target = path(command, 'target', context);
        const initial = context.host.initial?.(target);
        if (initial === undefined) throw new LogicError(`${target} has no document value to reset to`);
        const writes: LogicWrite[] = [];
        resetWrites(target, context.copy.get(target), initial, writes);
        for (const write of writes) context.copy.set(write.path, write.value as JsonValue);
    },
    'save-data': (command, context) => {
        const into = path(command, 'into', context);
        const map = context.copy.get(into);
        if (map !== undefined && !isObject(map)) throw new LogicError(`${into} is not a data map`);
        const record = value(command, context);
        const key = checkKey(
            command.key === undefined
                ? (context.host.newKey?.() ?? defaultKey())
                : String(resolveValue(command.key, context.scope, context.host))
        );
        const write = { path: `${into}.${key}`, value: record };
        const reason = context.guard(write);
        context.scope.key = key;
        if (reason !== undefined) {
            outcome(context, command, { status: 'rejected', reason, key });
            return;
        }
        context.copy.set(write.path, record);
        outcome(context, command, { status: 'accepted', key });
    },
    'delete-data': (command, context) => {
        const target = path(command, 'target', context);
        const key = target.slice(target.lastIndexOf('.') + 1);
        if (context.copy.get(target) === undefined) {
            outcome(context, command, { status: 'rejected', reason: `${target} does not exist`, key });
            return;
        }
        const reason = context.guard({ path: target });
        if (reason !== undefined) {
            outcome(context, command, { status: 'rejected', reason, key });
            return;
        }
        context.copy.delete(target);
        outcome(context, command, { status: 'accepted', key });
    },
    'pull-data': (command, context) => {
        const source = context.copy.get(path(command, 'from', context));
        if (source === undefined) throw new LogicError(`${command.from} has no value`);
        const target = path(command, 'target', context);
        const fields = context.host.fields?.(target);
        if (fields === undefined) {
            context.copy.set(target, source);
            return;
        }
        if (!isObject(source)) throw new LogicError(`${command.from} is not a record`);
        for (const [key, valuePath] of Object.entries(fields)) {
            if (Object.hasOwn(source, key)) context.copy.set(valuePath, source[key] as JsonValue);
        }
    },
    query: (command, context) => {
        const from = path(command, 'from', context);
        const into = path(command, 'into', context);
        const map = context.copy.get(from) ?? {};
        if (!isObject(map)) throw new LogicError(`${from} is not a data map`);
        let rows = Object.entries(map);
        if (command.filter !== undefined) {
            const filter = command.filter;
            rows = rows.filter(([key, record]) => condition(filter, { ...context.scope, key, record }));
        }
        const sort = command.sort === undefined ? undefined : readSort(resolveValue(command.sort, context.scope, context.host));
        if (sort) {
            rows.sort(([, a], [, b]) => {
                const order = compare(isObject(a) ? a[sort.by] : undefined, isObject(b) ? b[sort.by] : undefined);
                return sort.descending ? -order : order;
            });
        }
        const window = readWindow(command.window === undefined ? null : resolveValue(command.window, context.scope, context.host), rows.length);
        const field = context.copy.get(`${into}.key`);
        const keyField = typeof field === 'string' ? field : 'id';
        const records: JsonObject = {};
        rows.slice(window.first, window.first + window.count).forEach(([key, record], index) => {
            records[String(window.first + index)] = isObject(record) ? { ...record, [keyField]: key } : record;
        });
        context.copy.set(`${into}.${context.host.records?.(into) ?? 'records'}`, records);
        context.copy.set(`${into}.total`, rows.length);
    },
    notify: (command, context) => {
        const name = required(command, 'target');
        const payload = value(command, context);
        context.after.push(() => context.host.notify?.(name, payload));
    },
    emit: (command, context) => {
        const name = required(command, 'target');
        const payload = value(command, context);
        context.after.push(() => context.host.emit?.(name, payload));
    },
    call: (command, context) => {
        if (command.as === undefined) throw new LogicError('"call" needs "as"');
        context.calls.push({ name: required(command, 'target'), payload: value(command, context), as: command.as });
    },
    reject: () => {
        throw new LogicError('"reject" runs only in a guard rule');
    },
    navigate: (command, context) => {
        const screen = resolveValue(required(command, 'target'), context.scope, context.host);
        if (typeof screen !== 'string') throw new LogicError('"navigate" needs a screen name as its target');
        const params = command.value === undefined ? undefined : value(command, context);
        const route = routeTo(context.host.screens?.(), screen, params);
        if (isRouteRefusal(route)) throw new LogicError(route.reason);
        context.copy.set(ROUTE_PATH, route as unknown as JsonValue);
    }
};

/** Runs one command against the working copy; throws `LogicError` when it fails */
export function runCommand(command: LogicCommand, context: CommandContext): void {
    RUNNERS[command.command](command, context);
}
