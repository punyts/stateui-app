import { entryShape } from '../core/resolve/index.js';
import type { ComponentLibrary } from '../core/resolve/index.js';

/** The branches that hold nodes: the shell and the screens */
const NODE_ROOTS = ['$.app', '$.screens'];

interface StoreReader {
    get(path: string): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a node path (below `$.app` or `$.screens`) is at or below a runtime property of a node (`"runtime": true` in its shape, such as the
 * `body` of a list or the `slots` of a record view). A component writes those itself on every mount, so they are not
 * synced: a stored value would land on the next mount over what the component computes. Each node above the path is
 * read from the store and its component's shape is asked for the next step
 */
export function isRuntimeProperty(store: StoreReader, library: ComponentLibrary, path: string): boolean {
    const root = NODE_ROOTS.find((prefix) => path.startsWith(`${prefix}.`));
    if (root === undefined) return false;
    const steps = path.slice(root.length + 1).split('.');
    let at = root;
    for (const step of steps) {
        const node = store.get(at);
        if (!isRecord(node)) return false;
        const component = node['component'];
        if (typeof component === 'string') {
            if (entryShape(library[component])?.properties[step]?.runtime === true) return true;
        }
        at = `${at}.${step}`;
    }
    return false;
}
