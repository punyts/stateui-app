import type { JsonValue } from '../../core/types.js';

/**
 * Events as state. Logic on a server sees state, not events, so the runtime writes every event a node raises into
 * state before its `on` entry runs: `$.raised.<node path without $.>.<event>` (`$.raised.screens.home.children.save.press`
 * for the node at `$.screens.home.children.save`), with the store's `always`, so each one is a change even when it
 * repeats the value (a second press, the same row activated again). Rules and machines trigger on that path like on
 * any other; a link can read it too. The events have their own branch and never touch a node's state: a component that
 * watches its subtree (an accordion, a tree) is not disturbed by them, and none is written in the middle of its writes.
 *
 * - The value is the event's payload when it carries data (a row's key, a drawing's `{ key, x, y }`), else `true`.
 * - Events whose result already is state are not written: `change`, `input`, `valid`, `invalid`, `changed` (the value
 *   or validity the component writes) and `query` (as fast as typing).
 * - `hover` is written only when something uses it (`usesRaisedHover`: the document names a `$.raised` path with a `hover` step, or a pattern
 *   step that matches it) and at most once per `HOVER_THROTTLE_MS` per node, the last one always landing.
 */

/** The top-level branch that holds the events, by node path */
export const RAISED_KEY = 'raised';

/** Where an event of the node at `nodePath` is kept: `$.raised.<nodePath without $.>.<event>` */
export function raisedPath(nodePath: string, event: string): string {
    return `$.${RAISED_KEY}.${nodePath.startsWith('$.') ? nodePath.slice(2) : nodePath}.${event}`;
}

/** The events whose result is already state, so they are not written */
export const UNRECORDED_EVENTS: ReadonlySet<string> = new Set(['change', 'input', 'valid', 'invalid', 'changed', 'query']);

/** The shortest time between two hover writes of one node */
export const HOVER_THROTTLE_MS = 250;

/**
 * True when the document names a path in `$.raised` that is or may be a hover: one with a `hover` step, or a `*` or
 * `{name}` step that matches it, anywhere (a trigger, an `if`, a link)
 */
export function usesRaisedHover(document: unknown): boolean {
    const text = JSON.stringify(document) ?? '';
    for (const match of text.matchAll(/\$\.raised((?:\.[A-Za-z0-9_\-*{}]+)+)/g)) {
        const steps = (match[1] as string).split('.').slice(1);
        if (steps.some((step) => step === 'hover' || step === '*' || /^\{[^}]*\}$/.test(step))) return true;
    }
    return false;
}

/**
 * The value an event is written as: its payload as JSON without the drawing's `shape` path (the node's own path
 * says which shape it was), or `true` when it carries nothing
 */
export function raisedValue(payload: unknown): JsonValue {
    if (payload === undefined || payload === null) return true;
    let value: unknown;
    try {
        value = JSON.parse(JSON.stringify(payload)) as unknown;
    } catch {
        return true;
    }
    if (value === undefined || value === null) return true;
    if (typeof value === 'object' && !Array.isArray(value)) {
        const { shape: _shape, ...rest } = value as Record<string, JsonValue>;
        return Object.keys(rest).length === 0 ? true : rest;
    }
    return value as JsonValue;
}

/** What the recorder writes through: the store's `get` and `set` with its options */
export interface RaisedStore {
    get(path: string): unknown;
    set(path: string, value: never, options?: { always?: boolean }): boolean;
}

export interface RaisedRecorder {
    /** Writes `<path>.raised.<event>` for an event a node raised, unless the event is not recorded */
    record(event: string, payload: unknown, path: string): void;
    /** Cancels the trailing hover writes */
    dispose(): void;
}

export function createRaisedRecorder(store: RaisedStore, options: { hover: boolean; now?: () => number; throttleMs?: number }): RaisedRecorder {
    const now = options.now ?? (() => Date.now());
    const throttleMs = options.throttleMs ?? HOVER_THROTTLE_MS;
    const lastHover = new Map<string, number>();
    const trailing = new Map<string, { timer: ReturnType<typeof setTimeout>; value: JsonValue }>();

    /** Sets the leaf with `always`; a missing parent is made in the same write, as one object from the deepest one there */
    const write = (event: string, value: JsonValue, path: string): void => {
        const steps = raisedPath(path, event).split('.');
        let at = steps.length - 1;
        while (at > 1) {
            const parent: unknown = store.get(steps.slice(0, at).join('.'));
            if (typeof parent === 'object' && parent !== null && !Array.isArray(parent)) break;
            at -= 1;
        }
        let nested: JsonValue = value;
        for (let index = steps.length - 1; index > at; index -= 1) nested = { [steps[index] as string]: nested };
        store.set(steps.slice(0, at + 1).join('.'), nested as never, { always: true });
    };

    const hover = (value: JsonValue, path: string): void => {
        const pending = trailing.get(path);
        const since = now() - (lastHover.get(path) ?? -Infinity);
        if (since >= throttleMs && pending === undefined) {
            lastHover.set(path, now());
            write('hover', value, path);
            return;
        }
        // Within the window: the latest hover lands when it ends
        if (pending !== undefined) {
            pending.value = value;
            return;
        }
        const timer = setTimeout(() => {
            const last = trailing.get(path);
            trailing.delete(path);
            if (last === undefined) return;
            lastHover.set(path, now());
            write('hover', last.value, path);
        }, Math.max(0, throttleMs - since));
        trailing.set(path, { timer, value });
    };

    return {
        record(event, payload, path) {
            if (UNRECORDED_EVENTS.has(event)) return;
            const value = raisedValue(payload);
            if (event === 'hover') {
                if (options.hover) hover(value, path);
                return;
            }
            write(event, value, path);
        },
        dispose() {
            for (const { timer } of trailing.values()) clearTimeout(timer);
            trailing.clear();
        }
    };
}
