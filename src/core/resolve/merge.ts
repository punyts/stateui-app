import { typesOf } from '../shape/index.js';
import type { PropertyShape, Shape } from '../shape/index.js';
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

/** Finds the shape of a root component by name, so a merge can tell a `map` property from any other value */
export type ShapeLookup = (component: string) => Shape | undefined;

/** True when `name` is a property of the shape that reads an object as a keyed map */
function isMapProperty(shape: Shape | undefined, name: string): boolean {
    if (shape === undefined || !Object.hasOwn(shape.properties, name)) return false;
    return typesOf(shape.properties[name] as PropertyShape).includes('map');
}

function mergeObjects(
    base: JsonObject,
    over: JsonObject,
    removesOnNull: boolean,
    shapeOf: ShapeLookup | undefined,
    shape: Shape | undefined
): JsonObject {
    const result: JsonObject = cloneJson(base);
    const own = isNodeValue(base) ? shapeOf?.(base.component) ?? shape : shape;
    for (const [key, value] of Object.entries(over)) {
        const current = result[key];
        if (value === null && (removesOnNull || isNodeValue(current))) {
            delete result[key];
        } else {
            const isMap = key === RESERVED_KEYS.children || isMapProperty(own, key);
            result[key] = mergeInner(current, value, isMap, shapeOf, undefined);
        }
    }
    return result;
}

function mergeInner(
    base: JsonValue | undefined,
    over: JsonValue,
    removesOnNull: boolean,
    shapeOf: ShapeLookup | undefined,
    shape: Shape | undefined
): JsonValue {
    if (!isObject(base) || !isObject(over)) return cloneJson(over);
    if (isNodeValue(base) && isNodeValue(over) && base.component !== over.component) return cloneJson(over);
    return mergeObjects(base, over, removesOnNull, shapeOf, shape);
}

/**
 * Merges `over` onto `base`, deep and sparse, and returns a new value; neither input is changed.
 * Objects merge by key and `over` wins everywhere else. Arrays are replaced whole. A `null` removes a
 * child from a `children` map and a node from a slot. A node that names another component replaces the
 * node under it, because the two have different shapes.
 *
 * With `shapeOf` (and `shape`, the shape of `base` when it is not a node that names its component) a `null` also
 * removes an entry of a `map` property, such as a table's `columns`; a `null` anywhere else stays a value
 */
export function mergeValues(
    base: JsonValue | undefined,
    over: JsonValue,
    inChildren = false,
    shapeOf?: ShapeLookup,
    shape?: Shape
): JsonValue {
    return mergeInner(base, over, inChildren, shapeOf, shape);
}
