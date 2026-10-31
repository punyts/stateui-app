import { cloneJson } from '../resolve/index.js';
import { isObject } from '../resolve/merge.js';
import { PREFIXES, RESERVED_KEYS } from '../types.js';
import type { JsonObject } from '../types.js';

const ROOT_PATH = '$.app';

/** True for a content property name such as `_title`; the reserved `__` prefix is not content */
export function isContentKey(key: string): boolean {
    return key.startsWith(PREFIXES.content) && !key.startsWith(PREFIXES.reserved) && key.length > PREFIXES.content.length;
}

function collect(value: JsonObject, path: string, linked: ReadonlySet<string>): JsonObject {
    const found: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
        const itemPath = `${path}.${key}`;
        if (linked.has(itemPath) || key === RESERVED_KEYS.on) continue;
        if (isContentKey(key)) {
            found[key] = cloneJson(item);
        } else if (isObject(item)) {
            const inner = collect(item, itemPath, linked);
            if (Object.keys(inner).length > 0) found[key] = inner;
        }
    }
    return found;
}

/**
 * The content of an assembled application as a sparse overlay: every `_` property that is not linked, wherever it sits
 * in a node, including keyed maps (`columns.<key>._title`, `options.<key>._label`), `placement` (`_tab`) and the
 * entries of a content map (`_errors`). `linkedPaths` is `ExtractResult.linkedPaths`. Applying the result to
 * `$.app` puts the original language back. Branches without content are left out and the tree is not changed.
 * Arrays are not searched, because an overlay cannot address one of their items. `path` is the state path of the
 * root, `$.app` when absent
 */
export function extractBaseOverlay(tree: JsonObject, linkedPaths: readonly string[], path: string = ROOT_PATH): JsonObject {
    return collect(tree, path, new Set(linkedPaths));
}
