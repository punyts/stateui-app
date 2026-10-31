import { isObject } from '../resolve/merge.js';
import { PREFIXES, RESERVED_KEYS } from '../types.js';
import type { JsonObject, JsonValue } from '../types.js';
import type { SnapshotOptions, SnapshotStore, StateSnapshot } from './types.js';

const DATA_PATH = '$.data';
const APP_PATH = '$.app';
const NOT_ARTICULATION: readonly string[] = [
    RESERVED_KEYS.component,
    RESERVED_KEYS.layout,
    RESERVED_KEYS.placement,
    RESERVED_KEYS.theme,
    RESERVED_KEYS.on
];

type Exclude = (path: string) => boolean;

/** Copies a JSON value; anything that is not JSON (`undefined`, functions) is dropped. `undefined` means dropped */
function copyData(value: unknown, path: string, exclude: Exclude): JsonValue | undefined {
    if (exclude(path)) return undefined;
    if (Array.isArray(value)) {
        const items: JsonValue[] = [];
        value.forEach((item, index) => {
            const copy = copyData(item, `${path}.${index}`, exclude);
            if (copy !== undefined) items.push(copy);
        });
        return items;
    }
    if (typeof value === 'object' && value !== null) {
        const copy: JsonObject = {};
        for (const [key, item] of Object.entries(value)) {
            const itemCopy = copyData(item, `${path}.${key}`, exclude);
            if (itemCopy !== undefined) copy[key] = itemCopy;
        }
        return copy;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
        return value;
    }
    return undefined;
}

/**
 * Copies the articulation values below `value`: content (`_` keys) and the node's own keys (`component`, `on`,
 * `layout`, `placement`, `theme`) stay in the document. Containers that lose everything are dropped
 */
function copyArticulation(value: unknown, path: string, exclude: Exclude): JsonValue | undefined {
    if (exclude(path)) return undefined;
    if (Array.isArray(value)) {
        const items: JsonValue[] = [];
        value.forEach((item, index) => {
            const copy = copyArticulation(item, `${path}.${index}`, exclude);
            if (copy !== undefined) items.push(copy);
        });
        return items.length === 0 && value.length > 0 ? undefined : items;
    }
    if (isObject(value)) {
        const isNode = typeof value[RESERVED_KEYS.component] === 'string';
        const copy: JsonObject = {};
        for (const [key, item] of Object.entries(value)) {
            if (key.startsWith(PREFIXES.content) || (isNode && NOT_ARTICULATION.includes(key))) continue;
            const itemCopy = copyArticulation(item, `${path}.${key}`, exclude);
            if (itemCopy !== undefined) copy[key] = itemCopy;
        }
        return Object.keys(copy).length === 0 && Object.keys(value).length > 0 ? undefined : copy;
    }
    return copyData(value, path, exclude);
}

/**
 * The state of an application worth saving: `$.data` and the articulation values of `$.app` (an open modal, a
 * typed field value). Left out: `$.runtime` and every other branch (never read), content (`_` keys) and the node
 * structure (`component`, `on`, `layout`, `placement`, `theme`), which belong to the document, and `exclude`d
 * paths. Aliases (linked properties and content) and computed values are not in `store.get` results at all, so
 * they cannot appear. The result is a copy that shares nothing with the store. Never throws; a store without
 * `$.data` or `$.app` gives an empty object for it
 */
export function snapshotState(store: SnapshotStore, options: SnapshotOptions = {}): StateSnapshot {
    const exclude = options.exclude ?? (() => false);
    const data = copyData(store.get(DATA_PATH), DATA_PATH, exclude);
    const app = copyArticulation(store.get(APP_PATH), APP_PATH, exclude);
    return {
        data: isObject(data) ? data : {},
        app: isObject(app) ? app : {}
    };
}
