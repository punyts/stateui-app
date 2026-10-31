import type { BuildError } from '../errors/index.js';
import type { Node } from '../types.js';

/** One `<-key` property of a node: the node's `key` becomes an alias of `target` */
export interface Link {
    /** The state path of the node (or nested object) that carried the `<-key` property */
    statePath: string;
    /** The property name without the `<-` prefix */
    key: string;
    /** `$.data...`, `$row...`, a node reference (`^name.path`, `.path`) or, once rewritten, a runtime path */
    target: string;
    /** Set on the `$row.x` links of a slot: a missing field reads as `undefined` instead of failing the link */
    allowMissing?: boolean;
}

export interface ExtractResult {
    /** A copy of the tree without its `<-` properties */
    tree: Node;
    /** Every link, in tree order */
    links: Link[];
    /**
     * The path of every linked property (`statePath` and `key` joined). Locale overlays and the live-state
     * snapshot leave these out
     */
    linkedPaths: string[];
    errors: BuildError[];
}

export interface ExtractOptions {
    /** The state path of the tree's root node; `$.app` when absent */
    path?: string;
}

export interface RowLinkOptions {
    /** The state path of the row node; the parent of `rowPath` (the slot) when absent */
    path?: string;
}

/** The part of a store that links need */
export interface LinkStore {
    link: (fromPath: string, toPath: string, options?: { allowMissing?: boolean }) => boolean;
    unlink: (fromPath: string) => boolean;
    get: (path: string) => unknown;
}
