import { isNodeValue, isObject } from '../resolve/merge.js';
import { META_KEYS, PREFIXES, RESERVED_KEYS } from '../types.js';
import type { AppDocument, JsonValue } from '../types.js';

/** The state paths a document's nodes mark with metadata, each a "$." path the sync layer matches at and below */
export interface MetadataPaths {
    /** `@local`: stays on the device, never sent */
    local: string[];
    /** `@secret`: sent to the authority's server logic while online, never stored, logged or relayed */
    secret: string[];
    /** `@transient`: shared with everyone using the app, never stored */
    transient: string[];
}

type MarkKey = keyof MetadataPaths;

const MARKS: readonly MarkKey[] = ['local', 'secret', 'transient'];

/** Adds the paths one node marks: the node's own path for `true`, the path of each named property for a list */
function collect(node: Record<string, JsonValue>, path: string, into: MetadataPaths): void {
    for (const mark of MARKS) {
        const value = node[META_KEYS[mark]];
        if (value === true) into[mark].push(path);
        else if (Array.isArray(value)) for (const property of value) if (typeof property === 'string' && property !== '') into[mark].push(`${path}.${property}`);
    }
}

/** Walks a tree from `value` at `path`, collecting the marks of every node in it (`on` entries, links and content are skipped) */
function walk(value: JsonValue, path: string, into: MetadataPaths): void {
    if (!isObject(value)) return;
    if (isNodeValue(value)) collect(value, path, into);
    for (const [key, item] of Object.entries(value)) {
        if (key === RESERVED_KEYS.on || key.startsWith(PREFIXES.link) || key.startsWith(PREFIXES.content) || key.startsWith(PREFIXES.meta)) continue;
        walk(item, `${path}.${key}`, into);
    }
}

/**
 * The paths the nodes of a document's app and screens mark with `@local`, `@secret` and `@transient`. A mark of `true`
 * covers the node's whole branch; a list covers the named properties. Metadata is read from the definition only: an
 * instance never carries it. The host passes `local` and `secret` to its sync client and the server `secret` and
 * `transient` (merged with the document's `ephemeral` list) to the authority. Pure
 */
export function metadataPaths(document: AppDocument): MetadataPaths {
    const into: MetadataPaths = { local: [], secret: [], transient: [] };
    if (document.app !== undefined) walk(document.app as JsonValue, '$.app', into);
    const screens = document.screens;
    // A screen's root node is at `$.screens.{name}`
    for (const [name, screen] of Object.entries(screens ?? {})) walk(screen.root as JsonValue, `$.screens.${name}`, into);
    return into;
}
