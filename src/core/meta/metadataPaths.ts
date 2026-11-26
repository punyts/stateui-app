import { entryShape } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { isNodeValue, isObject } from '../resolve/merge.js';
import { META_KEYS, PREFIXES, RESERVED_KEYS } from '../types.js';
import type { AppDocument, JsonValue, PeerShare } from '../types.js';

/** The state paths a document's nodes mark with metadata, each a "$." path the sync layer matches at and below */
export interface MetadataPaths {
    /** `@local`: stays on the device, never sent */
    local: string[];
    /** `@secret`: sent to the authority's server logic while online, never stored, logged or relayed */
    secret: string[];
    /** `@transient`: shared with everyone using the app, never stored */
    transient: string[];
    /** `@share`: each branch and the path whose value names its peers */
    share: PeerShare[];
}

type MarkKey = 'local' | 'secret' | 'transient';

const PEERS_OF = 'peers of ';

/**
 * Where an instance holds what its peers have at `path`: `$.peers.<path>`, the path's segments after `$` joined by
 * `__`, one key, so the map of each shared branch is one value. `__` never starts a key of a definition, so no two paths
 * share a key
 */
export function peersPath(path: string): string {
    return `$.peers.${path.slice(2).split('.').join('__')}`;
}

const MARKS: readonly MarkKey[] = ['local', 'secret', 'transient'];

/**
 * Adds the paths one node marks: the node's own path for `true`, the path of each named property for a list, and the
 * properties its component's definition marks
 */
function collect(node: Record<string, JsonValue>, path: string, into: MetadataPaths, library: ComponentLibrary | undefined): void {
    const component = node['component'];
    const entry = library !== undefined && typeof component === 'string' && Object.hasOwn(library, component) ? library[component] : undefined;
    const defined = entry === undefined ? undefined : entryShape(entry)?.marks;
    for (const mark of MARKS) {
        const value = node[META_KEYS[mark]];
        if (value === true) {
            into[mark].push(path);
            continue;
        }
        const named = new Set<string>(defined?.[mark] ?? []);
        if (Array.isArray(value)) for (const property of value) if (typeof property === 'string' && property !== '') named.add(property);
        for (const property of named) into[mark].push(`${path}.${property}`);
    }
    const shared = node[META_KEYS.share];
    if (isObject(shared)) {
        for (const [property, rule] of Object.entries(shared)) {
            if (typeof rule === 'string' && rule.startsWith(PEERS_OF)) into.share.push({ path: `${path}.${property}`, by: `${path}${rule.slice(PEERS_OF.length)}` });
        }
    }
}

/** Walks a tree from `value` at `path`, collecting the marks of every node in it (`on` entries, links and content are skipped) */
function walk(value: JsonValue, path: string, into: MetadataPaths, library: ComponentLibrary | undefined): void {
    if (!isObject(value)) return;
    if (isNodeValue(value)) collect(value, path, into, library);
    for (const [key, item] of Object.entries(value)) {
        if (key === RESERVED_KEYS.on || key.startsWith(PREFIXES.link) || key.startsWith(PREFIXES.content) || key.startsWith(PREFIXES.meta)) continue;
        walk(item, `${path}.${key}`, into, library);
    }
}

/**
 * The paths the nodes of a document's app and screens mark with `@local`, `@secret` and `@transient`. A mark of `true`
 * covers the node's whole branch; a list covers the named properties, and so does the `@local`, `@secret` or
 * `@transient` list of the node's component in `library` (a button's `pressed`). Metadata is read from the definition only: an
 * instance never carries it. The host passes `local` and `secret` to its sync client and the server `secret` and
 * `transient` (merged with the document's `ephemeral` list) to the authority. `share` lists the `@share` branches, each
 * with the path (relative to its node, `peers of .board`) whose value names its peers. Pure
 */
export function metadataPaths(document: AppDocument, library?: ComponentLibrary): MetadataPaths {
    const into: MetadataPaths = { local: [], secret: [], transient: [], share: [] };
    if (document.app !== undefined) walk(document.app as JsonValue, '$.app', into, library);
    const screens = document.screens;
    // A screen's root node is at `$.screens.{name}`
    for (const [name, screen] of Object.entries(screens ?? {})) walk(screen.root as JsonValue, `$.screens.${name}`, into, library);
    return into;
}
