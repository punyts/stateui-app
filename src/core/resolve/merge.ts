import { RESERVED_KEYS } from '../types.js';
import type { JsonObject, JsonValue } from '../types.js';

export function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An object with a string `component` key */
export function isNodeValue(value: unknown): value is JsonObject & { component: string } {
    return isObject(value) && typeof value[RESERVED_KEYS.component] === 'string';
}

/** A deep copy of a JSON value that shares nothing with the original */
export function cloneJson<T extends JsonValue>(value: T): T {
    if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
    if (isObject(value)) {
        const copy: JsonObject = {};
        for (const [key, item] of Object.entries(value)) copy[key] = cloneJson(item);
        return copy as T;
    }
    return value;
}

function mergeObjects(base: JsonObject, over: JsonObject, inChildren: boolean): JsonObject {
    const result: JsonObject = cloneJson(base);
    for (const [key, value] of Object.entries(over)) {
        const current = result[key];
        if (value === null && (inChildren || isNodeValue(current))) {
            delete result[key];
        } else {
            result[key] = mergeValues(current, value, key === RESERVED_KEYS.children);
        }
    }
    return result;
}

/**
 * Merges `over` onto `base`, deep and sparse, and returns a new value; neither input is changed.
 * Objects merge by key and `over` wins everywhere else. Arrays are replaced whole. A `null` removes a
 * child from a `children` map and a node from a slot. A node that names another component replaces the
 * node under it, because the two have different shapes
 */
export function mergeValues(base: JsonValue | undefined, over: JsonValue, inChildren = false): JsonValue {
    if (!isObject(base) || !isObject(over)) return cloneJson(over);
    if (isNodeValue(base) && isNodeValue(over) && base.component !== over.component) return cloneJson(over);
    return mergeObjects(base, over, inChildren);
}
