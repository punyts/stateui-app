import type { BuildError } from '../errors/index.js';
import type { Shape } from '../shape/index.js';
import type { Node } from '../types.js';

/** A root component: it has a tag and a shape, and renders itself */
export interface RootEntry {
    tier: 'root';
    /** `ui-` plus the folder name */
    tag: string;
    shape: Shape;
}

/** A composed component: one default tree of nodes. A file's `exposes` key may be on the tree; it is metadata */
export interface ComposedEntry {
    tier: 'composed';
    tree: Node;
}

export type LibraryEntry = RootEntry | ComposedEntry;

/** The components a resolver may look up, by name */
export type ComponentLibrary = Readonly<Record<string, LibraryEntry>>;

/** The document-level `composed` entries, by name */
export type DocumentComposed = Readonly<Record<string, Node>>;

export interface ResolveOptions {
    /** The state path of the node being resolved; `$.app` when absent */
    path?: string;
}

export interface ResolveResult {
    /**
     * The merged, fully resolved tree: every node holds the name of a root component and its complete state.
     * A part that could not be resolved (unknown component, cycle) is left as written and has an error
     */
    node: Node;
    /** Every problem found, in tree order */
    errors: BuildError[];
    /**
     * For each state path where a composed component was expanded, the composed names, outermost first.
     * E2.9 uses it to find the nearest ancestor that is an instance of a named composed component
     */
    instances: Record<string, string[]>;
}
