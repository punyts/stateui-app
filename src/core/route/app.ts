import { isObject } from '../resolve/merge.js';
import { RESERVED_KEYS } from '../types.js';
import type { JsonValue } from '../types.js';

/**
 * The component of an app's root node (`$.app`) when the app has screens: it lays out the visible screens with its
 * `layout` and holds what is app wide (the document title, the toasts)
 */
export const APP_COMPONENT = 'app';

/** The state path of a screen's root: `$.screens.{name}` */
export function screenPath(name: string): string {
    return `$.screens.${name}`;
}

/** The paths of every `app` node below `value` (itself included), depth first in key order, not looking inside `on` entries */
export function findAppNodes(value: JsonValue | undefined, path: string, found: string[] = []): string[] {
    if (Array.isArray(value)) {
        value.forEach((item, index) => findAppNodes(item, `${path}.${index}`, found));
        return found;
    }
    if (!isObject(value)) return found;
    if (value[RESERVED_KEYS.component] === APP_COMPONENT) found.push(path);
    for (const [key, item] of Object.entries(value)) {
        if (key !== RESERVED_KEYS.on) findAppNodes(item, `${path}.${key}`, found);
    }
    return found;
}
