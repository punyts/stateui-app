import { RESERVED_KEYS } from '../types.js';
import type { JsonObject, JsonValue } from '../types.js';
import type { Shape } from './types.js';

/** A node below another node: its state path, the node, and whether it is a row template (`row: true`) */
export interface NodeChild {
    path: string;
    node: JsonObject & { component: string };
    row: boolean;
    /** The components the slot accepts, when its shape lists them; absent means any */
    accepts?: readonly string[];
}

function isObject(value: JsonValue | undefined): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNode(value: JsonValue | undefined): value is JsonObject & { component: string } {
    return isObject(value) && typeof value[RESERVED_KEYS.component] === 'string';
}

/**
 * The nodes directly below a node, in property order: the entries of `children`, every node-valued property (a
 * slot) and every node-valued field of a map item (a table column `cell`). `row` is true for a slot or field whose
 * property is `row: true`. `shape` is the node's component shape; without it only `children` entries are found
 * and no child is a row template
 */
export function nodeChildren(node: JsonObject, path: string, shape: Shape | undefined): NodeChild[] {
    const found: NodeChild[] = [];
    for (const [key, value] of Object.entries(node)) {
        if (key === RESERVED_KEYS.on || key === RESERVED_KEYS.component) continue;
        if (key === RESERVED_KEYS.children && isObject(value)) {
            for (const [childKey, child] of Object.entries(value)) {
                if (isNode(child)) {
                    found.push({
                        path: `${path}.${key}.${childKey}`,
                        node: child,
                        row: false,
                        ...(shape?.childComponents === undefined ? {} : { accepts: shape.childComponents })
                    });
                }
            }
            continue;
        }
        const property = shape !== undefined && Object.hasOwn(shape.properties, key) ? shape.properties[key] : undefined;
        if (isNode(value)) {
            found.push({
                path: `${path}.${key}`,
                node: value,
                row: property?.row === true,
                ...(property?.childComponents === undefined ? {} : { accepts: property.childComponents })
            });
            continue;
        }
        const items = property?.items;
        if (typeof items !== 'object' || !isObject(value)) continue;
        for (const [mapKey, entry] of Object.entries(value)) {
            if (!isObject(entry)) continue;
            for (const [field, fieldValue] of Object.entries(entry)) {
                if (!isNode(fieldValue)) continue;
                const fieldShape = Object.hasOwn(items, field) ? items[field] : undefined;
                found.push({
                    path: `${path}.${key}.${mapKey}.${field}`,
                    node: fieldValue,
                    row: fieldShape?.row === true,
                    ...(fieldShape?.childComponents === undefined ? {} : { accepts: fieldShape.childComponents })
                });
            }
        }
    }
    return found;
}
