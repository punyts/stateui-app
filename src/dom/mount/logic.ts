import { report } from '@punyts/core';
import type { Store } from '@punyts/state';
import { LOGIC_FAILED_EVENT, LOGIC_ORIGIN, NOTIFY_PREFIX, createLogicEngine, createLogicIndex, readLogic } from '../../core/logic/index.js';
import type { LogicChange, LogicHost, LogicWrite } from '../../core/logic/index.js';
import type { ResolvedTree } from '../../core/on/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import type { AppDocument, JsonValue } from '../../core/types.js';

const WATCHED = ['$.app.$all', '$.data.$all'];
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
 * Writes are batched to a microtask like the sync capture. Returns the function that stops it; undefined when the
 * document has no logic
 */
export function startBrowserLogic(options: BrowserLogicOptions): (() => void) | undefined {
    const { store, document } = options;
    if (document.logic === undefined) return undefined;
    const index = createLogicIndex(options.tree, options.library, document.data);
    const { logic } = readLogic(document.logic, { resolve: index.resolve });

    const host: LogicHost = {
        get: (path) => plain(store.get(path)),
        commit(writes: readonly LogicWrite[]) {
            const before = writes.map((write) => plain(store.get(write.path)));
            const done: number[] = [];
            try {
                writes.forEach((write, position) => {
                    if (write.value === undefined) store.delete(write.path, WRITE);
                    else store.set(write.path, write.value as never, WRITE);
                    done.push(position);
                });
            } catch (error) {
                for (const position of done.reverse()) {
                    const { path } = writes[position] as LogicWrite;
                    const value = before[position];
                    if (value === undefined) store.delete(path, WRITE);
                    else store.set(path, value as never, WRITE);
                }
                throw error;
            }
        },
        resolve: index.resolve,
        fields: index.fields,
        initial: index.initial,
        records: index.records,
        notify: (name, payload) => options.raise(`${NOTIFY_PREFIX}${name}`, payload),
        emit: (name, payload) => options.emit?.(name, payload),
        failed(failure) {
            report.error('Logic failed', { machine: failure.machine, from: failure.from, command: failure.command, reason: failure.reason });
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
            const reason = engine.guard(change);
            if (reason === undefined) {
                kept.push(change);
                continue;
            }
            if (undone.has(change.path)) continue;
            undone.add(change.path);
            if (old === undefined) store.delete(change.path, WRITE);
            else store.set(change.path, old as never, WRITE);
            host.failed?.({ machine: 'guard', reason });
        }
        if (kept.length > 0) engine.changes(kept);
    };
    const listener = (path: string, value: unknown, oldValue: unknown, action: string, origin?: string): void => {
        if (origin !== undefined || action.endsWith('-child') || action === 'relink') return;
        if (store.resolve(path) !== path) return;
        const change: LogicChange = action === 'delete' || value === undefined ? { path } : { path, value: plain(value) as JsonValue };
        pending.push({ change, old: plain(oldValue) });
        if (!scheduled) {
            scheduled = true;
            queueMicrotask(flush);
        }
    };

    engine.start();
    store.on(WATCHED, listener);
    return () => {
        stopped = true;
        store.off(WATCHED, listener);
    };
}

