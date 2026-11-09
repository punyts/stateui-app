import { cloneJson, isObject } from '../resolve/merge.js';
import type { JsonObject, JsonValue } from '../types.js';
import { pathSteps } from './pattern.js';
import { covers } from './working.js';
import { MAX_EFFECT_CACHE } from './types.js';
import type { LogicChange, LogicEffect, LogicEffectAnswer, LogicEffectInfo, LogicEffectStatus, LogicFailure, LogicHost, LogicWrite } from './types.js';

/** The value as JSON with the keys of every object sorted, so equal values give equal text */
export function canonicalJson(value: JsonValue): string {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
    if (isObject(value)) {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

/** The token of a request: a 53-bit hash of its canonical JSON, in base 36 */
export function requestToken(request: JsonValue): string {
    const text = canonicalJson(request);
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** What the effect runner needs from the engine */
export interface EffectDeps {
    host: LogicHost;
    /** Commits the writes of one effect and looks them up as a chain of their own; returns why the commit failed, if it did */
    apply(name: string, writes: LogicWrite[], label: string): string | undefined;
    failed(failure: LogicFailure): void;
    stopped(): boolean;
    /** ISO time for `status.at` */
    now(): string;
}

/** The effects of a document as the engine runs them */
export interface EffectRunner {
    /** Starts, cancels or answers from the cache the effects whose request changed, and updates window rows of changed records */
    settle(touched: readonly LogicChange[]): void;
    info(): LogicEffectInfo[];
    /** Aborts the running calls; answers that arrive later are dropped */
    stop(): void;
}

interface Cached {
    first: number;
    keys: string[];
    total?: number;
}

interface EffectState {
    name: string;
    effect: LogicEffect;
    /** The token of the request it last acted on */
    token?: string;
    /** False until its first settle, which keeps an answer already in state */
    seen: boolean;
    running?: { token: string; controller: AbortController };
    cache: Map<string, Cached>;
}

const PRIMARY_KEY = (value: JsonValue | undefined): string | undefined =>
    typeof value === 'string' && value !== '' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;

/**
 * Runs the effects of a document. Each settle reads every effect's request: a new token aborts the running call and
 * either refills the window from the cache or writes `loading` and calls the function (`host.functions.effects`, else
 * `host.effect`). An answer whose token is no longer the effect's is dropped; a current one commits the records merged
 * by key, the window rows in the answer's order with `total`, the value and `status` together. A change to a record of
 * `records.into` rewrites the window rows that hold its key
 */
export function createEffectRunner(effects: Readonly<Record<string, LogicEffect>>, deps: EffectDeps): EffectRunner {
    const { host } = deps;
    const states: EffectState[] = Object.entries(effects).map(([name, effect]) => ({ name, effect, seen: false, cache: new Map() }));
    const at = (path: string): string => (path.startsWith('^') ? (host.resolve?.(path) ?? path) : path);
    const status = (state: EffectState, value: Omit<LogicEffectStatus, 'at'>): LogicWrite => ({ path: at(state.effect.status), value: { ...value, at: deps.now() } as unknown as JsonValue });

    /** The record view's records property and key field */
    const view = (state: EffectState): { records: string; keyField: string; path: string } | undefined => {
        if (state.effect.window === undefined) return undefined;
        const path = at(state.effect.window);
        const field = host.get(`${path}.key`);
        return { path, records: `${path}.${host.records?.(path) ?? 'records'}`, keyField: typeof field === 'string' ? field : (state.effect.records?.key ?? 'id') };
    };

    /** The window writes for records in order from `first` */
    const windowWrites = (state: EffectState, first: number, records: readonly JsonValue[], keys: readonly (string | undefined)[], total: number | undefined): LogicWrite[] => {
        const target = view(state);
        if (!target) return [];
        const rows: JsonObject = {};
        records.forEach((record, index) => {
            const key = keys[index];
            rows[String(first + index)] = isObject(record) && key !== undefined ? { ...record, [target.keyField]: key } : record;
        });
        return [{ path: target.records, value: rows }, ...(total === undefined ? [] : [{ path: `${target.path}.total`, value: total }])];
    };

    const remember = (state: EffectState, token: string, entry: Cached): void => {
        const size = Math.min(state.effect.cache ?? 0, MAX_EFFECT_CACHE);
        if (size <= 0) return;
        state.cache.delete(token);
        state.cache.set(token, entry);
        while (state.cache.size > size) state.cache.delete(state.cache.keys().next().value as string);
    };

    /** Refills the window from the records map for a cached token; false when a record it needs is gone */
    const fromCache = (state: EffectState, token: string): boolean => {
        const entry = state.cache.get(token);
        const into = state.effect.records?.into;
        if (!entry || into === undefined) return false;
        const map = host.get(at(into));
        if (!isObject(map) || entry.keys.some((key) => !Object.hasOwn(map, key))) return false;
        remember(state, token, entry);
        const records = entry.keys.map((key) => map[key] as JsonValue);
        deps.apply(
            state.name,
            [...windowWrites(state, entry.first, records, entry.keys, entry.total), status(state, { token, state: 'ready', ...(entry.total === undefined ? {} : { total: entry.total }) })],
            `${state.name} cached`
        );
        return true;
    };

    const answered = (state: EffectState, token: string, answer: LogicEffectAnswer): void => {
        if (!isObject(answer as unknown as JsonValue)) throw new Error(`effect "${state.effect.run}" answered ${answer === null ? 'null' : typeof answer}, not an object`);
        if (answer.records !== undefined && !Array.isArray(answer.records)) throw new Error(`effect "${state.effect.run}" answered records that are not a list`);
        const first = typeof answer.first === 'number' && answer.first >= 0 ? Math.floor(answer.first) : 0;
        const total = typeof answer.total === 'number' ? answer.total : undefined;
        const records = answer.records ?? [];
        const keyName = state.effect.records?.key;
        const keys = records.map((record) => (keyName !== undefined && isObject(record) ? PRIMARY_KEY(record[keyName]) : undefined));
        const writes: LogicWrite[] = [];
        if (state.effect.records && records.length > 0) {
            const into = at(state.effect.records.into);
            if (!isObject(host.get(into))) writes.push({ path: into, value: {} });
            records.forEach((record, index) => {
                const key = keys[index];
                if (key !== undefined) writes.push({ path: `${into}.${key}`, value: record });
            });
        }
        if (answer.records !== undefined) writes.push(...windowWrites(state, first, records, keys, total));
        if (state.effect.value !== undefined && answer.value !== undefined) writes.push({ path: at(state.effect.value), value: answer.value });
        writes.push(status(state, { token, state: 'ready', ...(total === undefined ? {} : { total }) }));
        if (keys.every((key) => key !== undefined)) remember(state, token, { first, keys: keys as string[], ...(total === undefined ? {} : { total }) });
        const refused = deps.apply(state.name, writes, `${state.name} answered`);
        if (refused !== undefined) throw new Error(`the answer could not be written: ${refused}`);
    };

    const call = (state: EffectState, token: string, request: JsonValue): void => {
        const run = host.functions?.effects?.[state.effect.run];
        if (!run && !host.effect) {
            const reason = `the host registered no effect function "${state.effect.run}"`;
            deps.failed({ kind: 'effect', name: state.name, reason });
            deps.apply(state.name, [status(state, { token, state: 'error', reason })], `${state.name} failed`);
            return;
        }
        const controller = new AbortController();
        state.running = { token, controller };
        deps.apply(state.name, [status(state, { token, state: 'loading' })], `${state.name} loading`);
        const current = (): boolean => !deps.stopped() && !controller.signal.aborted && state.token === token;
        Promise.resolve()
            .then(() =>
                run
                    ? run(cloneJson(request), { signal: controller.signal })
                    : (host.effect as NonNullable<LogicHost['effect']>)({ name: state.name, run: state.effect.run, token, request: cloneJson(request) }, controller.signal)
            )
            .then(
                (answer) => {
                    if (!current()) return;
                    state.running = undefined;
                    try {
                        answered(state, token, answer);
                    } catch (error) {
                        deps.apply(state.name, [status(state, { token, state: 'error', reason: (error as Error).message })], `${state.name} failed`);
                    }
                },
                (error: unknown) => {
                    if (!current()) return;
                    state.running = undefined;
                    deps.apply(state.name, [status(state, { token, state: 'error', reason: error instanceof Error ? error.message : String(error) })], `${state.name} failed`);
                }
            );
    };

    /** Acts on a new request: cancels the running call, then answers from the cache or calls */
    const request = (state: EffectState): void => {
        const value = host.get(at(state.effect.request));
        const token = value === undefined ? undefined : requestToken(value);
        if (!state.seen) {
            state.seen = true;
            // an answer already in state (a reload, another window) is kept
            const held = host.get(at(state.effect.status));
            if (token !== undefined && isObject(held) && held['token'] === token && (held['state'] === 'ready' || held['state'] === 'error')) {
                state.token = token;
                return;
            }
        }
        if (token === state.token) return;
        state.running?.controller.abort();
        state.running = undefined;
        state.token = token;
        if (token === undefined) {
            const held = host.get(at(state.effect.status));
            if (isObject(held) && held['state'] !== 'idle') deps.apply(state.name, [status(state, { state: 'idle' })], `${state.name} idle`);
            return;
        }
        if (fromCache(state, token)) return;
        call(state, token, value as JsonValue);
    };

    /** Rewrites the window rows that hold a record a change touched */
    const follow = (state: EffectState, touched: readonly LogicChange[]): void => {
        const into = state.effect.records?.into;
        const target = view(state);
        if (into === undefined || !target || touched.length === 0) return;
        const map = at(into);
        let all = false;
        const keys = new Set<string>();
        const depth = pathSteps(map).length;
        for (const change of touched) {
            if (covers(change.path, map)) all = true;
            else if (covers(map, change.path)) keys.add(pathSteps(change.path)[depth] as string);
        }
        if (!all && keys.size === 0) return;
        const rows = host.get(target.records);
        const records = host.get(map);
        if (!isObject(rows) || !isObject(records)) return;
        const writes: LogicWrite[] = [];
        for (const [index, row] of Object.entries(rows)) {
            const key = isObject(row) ? PRIMARY_KEY(row[target.keyField]) : undefined;
            if (key === undefined || (!all && !keys.has(key))) continue;
            const record = records[key];
            if (!isObject(record)) continue;
            const next = { ...record, [target.keyField]: key };
            if (canonicalJson(next) !== canonicalJson(row)) writes.push({ path: `${target.records}.${index}`, value: next });
        }
        if (writes.length > 0) deps.apply(state.name, writes, `${state.name} rows`);
    };

    return {
        settle(touched) {
            if (deps.stopped()) return;
            for (const state of states) {
                follow(state, touched);
                request(state);
            }
        },
        info: () => states.map((state) => ({ name: state.name, ...(state.token === undefined ? {} : { token: state.token }), running: state.running !== undefined, cached: state.cache.size })),
        stop() {
            for (const state of states) state.running?.controller.abort();
        }
    };
}
