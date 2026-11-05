import { isObject } from '../resolve/merge.js';
import { RESERVED_KEYS } from '../types.js';
import type { JsonValue } from '../types.js';

/** The component the shell shows the visible screen in */
export const OUTLET_COMPONENT = 'outlet';

/** The state path of a screen's root: `$.screens.{name}` */
export function screenPath(name: string): string {
    return `$.screens.${name}`;
}

/**
 * The state path of the first `outlet` node in `tree` (at `path`), depth first in key order, not looking inside `on`
 * entries; undefined when there is none
 */
export function findOutlet(tree: JsonValue | undefined, path: string): string | undefined {
    if (Array.isArray(tree)) {
        for (const [index, item] of tree.entries()) {
            const found = findOutlet(item, `${path}.${index}`);
            if (found !== undefined) return found;
        }
        return undefined;
    }
    if (!isObject(tree)) return undefined;
    if (tree[RESERVED_KEYS.component] === OUTLET_COMPONENT) return path;
    for (const [key, item] of Object.entries(tree)) {
        if (key === RESERVED_KEYS.on) continue;
        const found = findOutlet(item, `${path}.${key}`);
        if (found !== undefined) return found;
    }
    return undefined;
}
