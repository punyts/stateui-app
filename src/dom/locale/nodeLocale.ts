import { buildAppOverlay, extractBaseOverlay } from '../../core/locale/index.js';
import type { ComponentOverlays } from '../../core/locale/index.js';
import { cloneJson, mergeValues } from '../../core/resolve/index.js';
import type { ComponentLibrary, DocumentComposed } from '../../core/resolve/index.js';
import { isNodeValue, isObject } from '../../core/resolve/merge.js';
import type { JsonObject, JsonValue } from '../../core/types.js';
import type { LocaleStore } from './switchLocale.js';

const ROOT_PATH = '$.app';
const LOCALE_PATH = '$.locale';

/** What a store listener receives */
type StoreListener = (path: string, value: unknown, oldValue: unknown, action: string) => void;

/** The part of a store that the node localizer needs: reading, applying and listening */
export interface NodeLocaleStore extends LocaleStore {
    get: (path: string) => unknown;
    on: (path: string, listener: StoreListener) => void;
    off: (path: string, listener?: StoreListener) => void;
}

export interface NodeLocaleOptions {
    store: NodeLocaleStore;
    /**
     * The overlay per language code, including the base language: the same object that is passed to `switchLocale`.
     * The localizer changes it in place, so a node created later is part of every later switch, back to the base
     * language too
     */
    overlays: Record<string, JsonObject>;
    /** The language the content of the application was written in; `overlays[baseLocale]` is its base overlay */
    baseLocale: string;
    /** Each component's overlay by name and language, as for `buildAppOverlay` */
    componentOverlays: ComponentOverlays;
    /** The document's `locales`: overrides by language that sit on top of the component overlays */
    appOverrides?: Readonly<Record<string, JsonObject>>;
    library?: ComponentLibrary;
    composed?: DocumentComposed;
    /** `ResolveResult.instances` of the mounted application */
    instances?: Readonly<Record<string, readonly string[]>>;
}

/** What a node written later gets, and the control over listening for such writes */
export interface NodeLocale {
    /**
     * For code that creates a node itself (a list or table row, a modal): records the node's content as base content,
     * records its translation for every language, and returns a copy of `value` in the current language, ready to be
     * written at `path`. Call it immediately before the write; the write is then recognised and not processed again.
     * `instances` is `ResolveResult.instances` of the node when it came from composed components, with paths
     * absolute (`resolveNode(node, library, composed, { path })`). Nothing is written to the store
     */
    prepare(path: string, value: JsonObject, instances?: Readonly<Record<string, readonly string[]>>): JsonObject;
    /** Starts listening for nodes written to `$.app`; returns a function that stops. Calling it twice listens once */
    watch(): () => void;
    /** Forgets what is known about a path and below it: removes it from every overlay. `watch` calls it for a delete */
    forget(path: string): void;
}

function segmentsBelow(path: string, root: string): string[] | undefined {
    if (path === root) return [];
    return path.startsWith(`${root}.`) ? path.slice(root.length + 1).split('.') : undefined;
}

function at(value: JsonValue | undefined, segments: readonly string[]): JsonObject | undefined {
    let current = value;
    for (const segment of segments) {
        if (!isObject(current) || !Object.hasOwn(current, segment)) return undefined;
        current = current[segment];
    }
    return isObject(current) ? current : undefined;
}

function wrap(segments: readonly string[], value: JsonObject): JsonObject {
    let wrapped = value;
    for (const segment of [...segments].reverse()) wrapped = { [segment]: wrapped };
    return wrapped;
}

function isEmpty(value: JsonObject): boolean {
    return Object.keys(value).length === 0;
}

/**
 * Whether an event at `path` reports a value that lives somewhere else: a store link (alias) shows it at `path`, and
 * the value of the event is a proxy of the resolved path. Such a node belongs to whatever owns the target (a record
 * view's pooled slots are shown under the view's `slots` property but live under `$.runtime`) and is not a node of
 * `$.app`: recording it would put a path that is not in `$.app` into the overlays, and a switch of language applying
 * that overlay through the alias would overwrite the owner's nodes
 */
function isAlias(path: string, value: unknown): boolean {
    if (value === null || typeof value !== 'object') return false;
    const resolved = (value as { __path?: unknown }).__path;
    return typeof resolved === 'string' && resolved !== path;
}

function holdsNode(value: JsonValue): boolean {
    if (isNodeValue(value)) return true;
    if (Array.isArray(value)) return false;
    return isObject(value) && Object.values(value).some((item) => holdsNode(item));
}

/** Merges `source` into `target` in place, deep; the values taken from `source` are copies */
function mergeInto(target: JsonObject, source: JsonObject): void {
    for (const [key, value] of Object.entries(source)) {
        const current = target[key];
        if (isObject(value) && isObject(current)) mergeInto(current, value);
        else target[key] = cloneJson(value);
    }
}

function removeFrom(target: JsonObject, segments: readonly string[]): void {
    const [head, ...rest] = segments;
    if (head === undefined || !Object.hasOwn(target, head)) return;
    if (rest.length === 0) {
        delete target[head];
        return;
    }
    const inner = target[head];
    if (!isObject(inner)) return;
    removeFrom(inner, rest);
    if (isEmpty(inner)) delete target[head];
}

/**
 * Creates the localizer for nodes created after mount. A node written to `$.app` after load (a keyed entry added to
 * `children`, a `children` map added to a node, a node a composed component creates, a keyed entry such as a static
 * select option added under an existing node) gets the overlay of its component for the current `$.locale`, and
 * every language's overlay learns the new content, so switching back and forth afterwards stays complete.
 *
 * The overlay of a node is what `buildAppOverlay` gives for it: its component's overlay on content that still
 * holds the component's default, then the document's `appOverrides` for its path. A keyed entry under an existing
 * node takes the component overlay's entry for its key, when there is one, and the overrides for its path.
 *
 * Timing: a write emits its `insert` event at the new path before the event at the parent that makes a list
 * render the node, so the overlay is applied in the same write, before the first render. Code that creates nodes
 * itself uses `prepare` and writes the node already translated.
 *
 * A write that replaces an existing value is not creation and is left alone. Writers should add nodes under new
 * keys; a delete removes the node from every overlay
 */
export function createNodeLocale(options: NodeLocaleOptions): NodeLocale {
    const { store, overlays, baseLocale, componentOverlays, library, composed } = options;
    const instances: Record<string, readonly string[]> = { ...(options.instances ?? {}) };
    const prepared = new Set<string>();
    let applying = false;
    let stop: (() => void) | undefined;

    const currentLocale = (): string => {
        const value = store.get(LOCALE_PATH);
        return typeof value === 'string' ? value : baseLocale;
    };

    const languages = (): string[] => {
        const codes = new Set<string>(Object.keys(overlays));
        for (const byCode of Object.values(componentOverlays)) for (const code of Object.keys(byCode)) codes.add(code);
        for (const code of Object.keys(options.appOverrides ?? {})) codes.add(code);
        codes.delete(baseLocale);
        return [...codes];
    };

    const overridesAt = (code: string, segments: readonly string[]): JsonObject => {
        const overrides = options.appOverrides !== undefined && Object.hasOwn(options.appOverrides, code) ? options.appOverrides[code] : undefined;
        return at(overrides, segments) ?? {};
    };

    /** The nearest ancestor of `path` in the store that is a node, with the path below it */
    const ownerOf = (segments: readonly string[]): { path: string; node: JsonObject; below: string[] } | undefined => {
        for (let depth = segments.length - 1; depth >= 0; depth--) {
            const path = [ROOT_PATH, ...segments.slice(0, depth)].join('.');
            const value = store.get(path);
            if (isNodeValue(value)) return { path, node: cloneJson(value as JsonObject), below: segments.slice(depth) };
        }
        return undefined;
    };

    /** The overlay of one language for a created value, relative to the value's path */
    const layerOf = (code: string, path: string, segments: readonly string[], value: JsonObject): JsonObject => {
        const overrides = overridesAt(code, segments);
        if (holdsNode(value)) {
            return buildAppOverlay(code, value, componentOverlays, overrides, { library, composed, instances, path });
        }
        const owner = ownerOf(segments);
        if (owner === undefined) return overrides;
        const ownerOverlay = buildAppOverlay(code, owner.node, componentOverlays, {}, { instances, path: owner.path });
        const entry = at(ownerOverlay, owner.below) ?? {};
        return mergeValues(entry, overrides) as JsonObject;
    };

    const record = (path: string, value: JsonObject, extra?: Readonly<Record<string, readonly string[]>>): JsonObject | undefined => {
        const segments = segmentsBelow(path, ROOT_PATH);
        if (segments === undefined || segments.length === 0) return undefined;
        if (extra !== undefined) Object.assign(instances, extra);
        const base = extractBaseOverlay(value, [], path);
        if (!isEmpty(base)) mergeInto((overlays[baseLocale] ??= {}), wrap(segments, base));
        const current = currentLocale();
        let forCurrent: JsonObject | undefined;
        for (const code of languages()) {
            const layer = layerOf(code, path, segments, value);
            if (isEmpty(layer)) continue;
            mergeInto((overlays[code] ??= {}), wrap(segments, layer));
            if (code === current) forCurrent = layer;
        }
        return forCurrent;
    };

    const forget = (path: string): void => {
        const segments = segmentsBelow(path, ROOT_PATH);
        if (segments === undefined || segments.length === 0) return;
        for (const overlay of Object.values(overlays)) removeFrom(overlay, segments);
        for (const key of Object.keys(instances)) {
            if (key === path || key.startsWith(`${path}.`)) delete instances[key];
        }
    };

    const skipPrepared = (path: string): boolean => {
        for (const known of prepared) {
            if (path === known) {
                prepared.delete(known);
                return true;
            }
            if (path.startsWith(`${known}.`)) return true;
        }
        return false;
    };

    const listener: StoreListener = (path, value, _oldValue, action) => {
        if (applying) return;
        if (action !== 'delete' && isAlias(path, value)) return;
        if (action === 'delete') {
            prepared.delete(path);
            forget(path);
            return;
        }
        if (action !== 'insert' || !isObject(value) || skipPrepared(path)) return;
        const layer = record(path, value as JsonObject);
        if (layer === undefined) return;
        const segments = segmentsBelow(path, ROOT_PATH) ?? [];
        applying = true;
        try {
            store.apply(ROOT_PATH, wrap(segments, layer));
        } finally {
            applying = false;
        }
    };

    return {
        prepare(path, value, extra) {
            const layer = record(path, value, extra);
            prepared.add(path);
            return layer === undefined ? cloneJson(value) : (mergeValues(value, layer) as JsonObject);
        },
        watch() {
            if (stop !== undefined) return stop;
            const pattern = `${ROOT_PATH}.$all`;
            store.on(pattern, listener);
            const stopper = (): void => {
                store.off(pattern, listener);
                if (stop === stopper) stop = undefined;
            };
            stop = stopper;
            return stopper;
        },
        forget
    };
}
