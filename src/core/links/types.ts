import type { BuildError } from '../errors/index.js';
import type { Frame } from '../on/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import type { Node } from '../types.js';

/** One `<-key` property of a node: the node's `key` becomes an alias of `target` */
export interface Link {
    /** The state path of the node (or nested object) that carried the `<-key` property */
    statePath: string;
    /** The property name without the `<-` prefix */
    key: string;
    /** `$.data...`, `$row...`, a node reference (`^name.path`, `.path`) or a runtime path (`$.runtime...`) */
    target: string;
    /** Set on the `$row.x` links of a slot: a missing field reads as `undefined` instead of failing the link */
    allowMissing?: boolean;
    /**
     * Set on a node reference: the runtime path of the exposed property it reaches (`$.runtime.nodes.app.list.current`).
     * The component creates that property after links are applied, so until then it is an alias of `$.runtime.empty`
     */
    exposed?: string;
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

/** What resolving a node reference needs: the shapes, to find the exposed property, and the composed instances */
export interface ReferenceOptions {
    /** The components of the document. Without it node references are returned as written and not checked */
    library?: ComponentLibrary;
    /** `ResolveResult.instances`: where composed components were expanded, for `^name` references; empty when absent */
    instances?: Readonly<Record<string, string[]>>;
    /**
     * The chain of the node that owns the extracted tree, the owner last. Set for a row template, whose relative
     * references resolve against its owner and never against the slot's own nodes
     */
    owner?: readonly Frame[];
}

export interface ExtractOptions extends ReferenceOptions {
    /** The state path of the tree's root node; `$.app` when absent */
    path?: string;
    /**
     * The resolved nodes from `$.app` down to the nearest node above the tree, outermost first, when the tree is one
     * node of a larger app (a node written after mount). Node references then reach outside the tree as they would
     * in the whole app; the first ancestor's node should hold the tree at `path`, so a `^name` search finds it there
     */
    ancestors?: readonly { node: Node; path: string }[];
}

export interface RowLinkOptions extends ReferenceOptions {
    /** The state path of the row node; the parent of `rowPath` (the slot) when absent */
    path?: string;
}

/** The part of a store that links need */
export interface LinkStore {
    link: (fromPath: string, toPath: string, options?: { allowMissing?: boolean }) => boolean;
    unlink: (fromPath: string) => boolean;
    get: (path: string) => unknown;
    /** Needed to create the runtime branch an `exposed` link reaches into */
    set?: (path: string, value: object) => boolean;
}
