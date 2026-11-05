import { report } from '@punyts/core';
import type { Store } from '@punyts/state';
import { LOGIC_FAILED_EVENT, LOGIC_ORIGIN, NOTIFY_PREFIX, createLogicEngine, createLogicIndex, readLogic } from '../../core/logic/index.js';
import type { LogicChange, LogicHost, LogicWrite } from '../../core/logic/index.js';
import type { ResolvedTree } from '../../core/on/index.js';
import { cloneJson, resolveNode } from '../../core/resolve/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { ROUTE_PATH } from '../../core/route/index.js';
import { isRoutePath, writeRoute } from './screens.js';
import type { AppDocument, JsonValue, Node } from '../../core/types.js';

const WATCHED = ['$.app.$all', '$.data.$all'];
/** Also watched in an app with screens */
const SCREEN_WATCHED = ['$.screens.$all', '$.route.$all'];
const WRITE = { origin: LOGIC_ORIGIN };

export interface BrowserLogicOptions {
    store: Store<unknown>;
    document: AppDocument;
    library: ComponentLibrary;
    /** The resolved `app` tree, for node references, form fields and `reset` */
    tree: ResolvedTree;
    /** Raises an app event on the root node (`logic.failed`, `notify.<name>`) */
    raise(name: string, payload: JsonValue): void;
    /** Sends an app event to the server, as the `emit` command does */
    emit?(name: string, payload: JsonValue): void;
}

/** A plain copy of what the store holds, which may be a proxy */
function plain(value: unknown): JsonValue | undefined {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object') return value as JsonValue;
    return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/**
 * Runs the document's logic in the browser, for Standalone and Persisted apps. Only the store's own writes (untagged:
 * the user, components and `on` commands) are looked up; host and sync writes carry an origin and are skipped, so
 * several open windows of one app run each transition once. The logic's writes carry the origin `logic`, which the
 * runtime's sync capture sends and this capture skips, since the engine runs chains itself.
 *
 * A guard that refuses a change undoes it (the value before the turn is written back) and raises `logic.failed`.
 * Writes are batched to a microtask like the sync capture. Timers (`after`, `debounce`) use `setTimeout` and live as
 * long as the mount; `call` is never answered in the browser. Returns the function that stops it and its timers;
 * undefined when the document has no logic
 */
export function startBrowserLogic(options: BrowserLogicOptions): (() => void) | undefined {
    const { store, document } = options;
    if (document.logic === undefined) return undefined;
    const trees: Record<string, ResolvedTree> = {};
    for (const [name, screen] of Object.entries(document.screens ?? {})) {
        const result = resolveNode(cloneJson(screen.root as unknown as JsonValue) as unknown as Node, options.library, document.composed, { path: `$.screens.${name}` });
        trees[name] = { node: result.node, instances: result.instances };
    }
    const index = createLogicIndex(options.tree, options.library, document.data, {
        trees,
        current: () => {
            const screen = store.get(`${ROUTE_PATH}.screen`);
            return typeof screen === 'string' ? screen : undefined;
        }
    });
    const { logic } = readLogic(document.logic, { resolve: index.resolve });

    /**
     * While a guard looks at a change the store already holds, the value the change replaced: a guard judges what
     * would change, and with the new value read as current every change would look like none
     */
    let beforeChange: Map<string, JsonValue | undefined> | undefined;

    const watched = document.screens === undefined ? WATCHED : [...WATCHED, ...SCREEN_WATCHED];
    /** Writes or deletes `path` with the logic's origin; `$.route` is protected, and `navigate` is the logic's way to write it */
    const write = (path: string, value: JsonValue | undefined): void => {
        if (isRoutePath(path)) writeRoute(store as never, path, value, WRITE);
        else if (value === undefined) store.delete(path, WRITE);
        else store.set(path, value as never, WRITE);
    };

    const host: LogicHost = {
        get: (path) => (beforeChange?.has(path) ? beforeChange.get(path) : plain(store.get(path))),
        commit(writes: readonly LogicWrite[]) {
            const before = writes.map((write) => plain(store.get(write.path)));
            const done: number[] = [];
            try {
                writes.forEach((one, position) => {
                    write(one.path, one.value);
                    done.push(position);
                });
            } catch (error) {
                for (const position of done.reverse()) write((writes[position] as LogicWrite).path, before[position]);
                throw error;
            }
        },
        resolve: index.resolve,
        screens: () => document.screens,
        fields: index.fields,
        initial: index.initial,
        records: index.records,
        notify: (name, payload) => options.raise(`${NOTIFY_PREFIX}${name}`, payload),
        emit: (name, payload) => options.emit?.(name, payload),
        schedule(ms, run) {
            const timer = setTimeout(run, ms);
            return () => clearTimeout(timer);
        },
        failed(failure) {
            report.error('Logic failed', { kind: failure.kind, name: failure.name, from: failure.from, command: failure.command, reason: failure.reason });
            options.raise(LOGIC_FAILED_EVENT, { ...failure } as unknown as JsonValue);
        }
    };
    const engine = createLogicEngine(logic, host);

    let pending: { change: LogicChange; old: JsonValue | undefined }[] = [];
    let scheduled = false;
    let stopped = false;
    const flush = (): void => {
        scheduled = false;
        if (stopped || pending.length === 0) return;
        const batch = pending;
        pending = [];
        const kept: LogicChange[] = [];
        const undone = new Set<string>();
        for (const { change, old } of batch) {
            beforeChange = new Map([[change.path, old]]);
            let refused: { name: string; reason: string } | undefined;
            try {
                refused = engine.refusal(change);
            } finally {
                beforeChange = undefined;
            }
            if (refused === undefined) {
                kept.push(change);
                continue;
            }
            if (undone.has(change.path)) continue;
            undone.add(change.path);
            if (old === undefined) store.delete(change.path, WRITE);
            else store.set(change.path, old as never, WRITE);
            host.failed?.({ kind: 'guard', name: refused.name, reason: refused.reason });
        }
        if (kept.length > 0) engine.changes(kept);
    };
    const listener = (path: string, value: unknown, oldValue: unknown, action: string, origin?: string): void => {
        if (origin !== undefined || action.endsWith('-child') || action === 'relink') return;
        if (store.resolve(path) !== path) return;
        const old = plain(oldValue);
        const change: LogicChange = action === 'delete' || value === undefined ? { path } : { path, value: plain(value) as JsonValue };
        if (old !== undefined) change.previous = old;
        pending.push({ change, old });
        if (!scheduled) {
            scheduled = true;
            queueMicrotask(flush);
        }
    };

    engine.start();
    store.on(watched, listener);
    return () => {
        stopped = true;
        engine.stop();
        store.off(watched, listener);
    };
}

