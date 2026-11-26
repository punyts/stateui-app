import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { extractLinks } from '../links/index.js';
import type { Link } from '../links/index.js';
import { entryShape } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { nodeChildren, validateNode } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import { META_KEYS, RESERVED_KEYS } from '../types.js';
import type { JsonValue, Node } from '../types.js';
import { dataPathExists } from './document.js';
import type { ValidateDocumentOptions } from './types.js';

const DATA_TARGET = /^\$\.data(\.|$)/;

/** The properties that are a component's own state rather than data: whether it shows, whether it is open */
const OWN_STATE = new Set(['hidden', 'open']);

/**
 * The branches a component with a fixed shape declares: its properties that hold a node (a form's `body`, a dialog's
 * `footer`). docs/design/state-definitions-and-instances.md: such a component keeps its nodes there, and only a
 * component that lays out children (`layout`, a `placement` for them, or a `childComponents` list) holds `children`
 */
export function declaredBranches(shape: Shape): string[] {
    return Object.entries(shape.properties)
        .filter(([, property]) => property.type === 'node')
        .map(([name]) => name);
}

/** True when a component takes `children`: it lays them out, places them, or names the components it accepts */
function holdsChildren(shape: Shape): boolean {
    return shape.layout || shape.placement !== undefined || shape.childComponents !== undefined;
}

/** True when a property of a shape is the component's own state or look: `hidden`, `open` or a shared look (`tone`, `size`) */
function ownState(shape: Shape, name: string): boolean {
    return OWN_STATE.has(name) || shape.shared.includes(name);
}

function shapeOf(library: ComponentLibrary, component: string): Shape | undefined {
    if (!Object.hasOwn(library, component)) return undefined;
    const entry = library[component];
    return entryShape(entry);
}

/** True when the library names `component` as a shape component (graphics), which only a drawing or a scene draws */
export function isShapeComponent(library: ComponentLibrary, component: string): boolean {
    return Object.hasOwn(library, component) && library[component]?.tier === 'shape';
}

/**
 * Why a slot refuses a node of `component`, as a `SUI-NODE-CHILD` error for a state path, or undefined when it takes
 * it. `accepts` is the slot's `childComponents`. A slot that lists them takes only those; a slot that lists none
 * takes any root or composed component but no shape component, since nothing there would draw it
 */
export function childRefusal(
    library: ComponentLibrary,
    component: string,
    accepts: readonly string[] | undefined
): ((path: string) => BuildError) | undefined {
    if (accepts === undefined ? !isShapeComponent(library, component) : accepts.includes(component)) return undefined;
    const other = accepts === undefined ? 'no shapes' : accepts.join(', ');
    return (path) => buildError('SUI-NODE-CHILD', { component, path, statePath: path, other });
}

/**
 * The `SUI-NODE-CHILD` errors of a resolved subtree written at `path` into a slot that takes `accepts` (its
 * `childComponents`; undefined for a slot that lists none): the node itself and every node below it that its slot
 * refuses. A shape component outside a drawing or a scene is one of them
 */
export function refusedChildren(
    node: Node,
    path: string,
    library: ComponentLibrary,
    accepts: readonly string[] | undefined
): BuildError[] {
    const errors: BuildError[] = [];
    const visit = (current: Node, at: string, slot: readonly string[] | undefined): void => {
        const refused = childRefusal(library, current.component, slot);
        if (refused !== undefined) errors.push(refused(at));
        const shape = Object.hasOwn(library, current.component) ? entryShape(library[current.component]) : undefined;
        for (const child of nodeChildren(current, at, shape)) visit(child.node as Node, child.path, child.accepts);
    };
    visit(node, path, accepts);
    return errors;
}

/**
 * A resolved node holds the default of every runtime property, so a runtime property that still has its default was
 * not set by the node. Those are left out before `validateNode`, which reports a node that sets one to another value
 */
function withoutRuntimeDefaults(shape: Shape, node: Node): Node {
    const copy: Node = { ...node };
    for (const [name, property] of Object.entries(shape.properties)) {
        if (property.runtime && Object.hasOwn(copy, name) && JSON.stringify(copy[name]) === JSON.stringify(property.default)) {
            delete copy[name];
        }
    }
    return copy;
}

class TreeChecker {
    readonly errors: BuildError[] = [];
    /** The path of each `@id` found so far: an id names one node of the tree */
    private readonly ids = new Map<string, string>();
    /** The shape of each node visited, by state path, for the link checks */
    private readonly shapes = new Map<string, Shape>();
    constructor(
        private readonly library: ComponentLibrary,
        private readonly instances: Readonly<Record<string, string[]>>,
        private readonly rootPath: string,
        private readonly data: JsonValue | undefined,
        private readonly options: ValidateDocumentOptions
    ) {}

    /**
     * `validateNode` also reads the first level of each node in a slot, which the walk then checks itself, so a
     * `$row` error it has already reported at the same path is left out
     */
    private addNodeErrors(found: BuildError[]): void {
        for (const error of found) {
            const seen =
                error.code === 'SUI-LINK-ROW' &&
                this.errors.some((known) => known.code === error.code && known.statePath === error.statePath);
            if (!seen) this.errors.push(error);
        }
    }

    /** Checks every node against its shape; `insideRow` is true inside a `row: true` slot, where `$row` is legal */
    visit(node: Node, path: string, insideRow: boolean): void {
        const shape = shapeOf(this.library, node.component);
        const id = (node as Record<string, JsonValue>)[META_KEYS.id];
        if (typeof id === 'string') {
            const other = this.ids.get(id);
            if (other === undefined) this.ids.set(id, path);
            else this.errors.push(buildError('SUI-NODE-ID-TWICE', { name: id, path, other, statePath: path }));
        }
        if (shape) {
            this.shapes.set(path, shape);
            this.addNodeErrors(validateNode(shape, withoutRuntimeDefaults(shape, node), path, { ...this.options, insideRow }));
            const branches = declaredBranches(shape);
            if (branches.length > 0 && !holdsChildren(shape) && Object.hasOwn(node, RESERVED_KEYS.children)) {
                const at = `${path}.${RESERVED_KEYS.children}`;
                this.errors.push(buildError('SUI-NODE-BRANCH', { component: node.component, path: at, other: branches.join(', '), statePath: at }));
            }
        }
        for (const child of nodeChildren(node, path, shape)) {
            const refused = childRefusal(this.library, child.node.component, child.accepts);
            if (refused !== undefined) this.errors.push(refused(child.path));
            this.visit(child.node as Node, child.path, insideRow || child.row);
        }
    }

    /**
     * Warns of a `$.data` value that only a component's own state reads (`hidden`, `open` or a look): that is the
     * component's state, which its instance keeps, not a field of the data (SUI-LINK-OWN). A value read by anything else
     * too is data
     */
    private checkOwnState(links: readonly Link[]): void {
        const byTarget = new Map<string, Link[]>();
        for (const link of links) {
            if (!DATA_TARGET.test(link.target)) continue;
            byTarget.set(link.target, [...(byTarget.get(link.target) ?? []), link]);
        }
        for (const [target, bound] of byTarget) {
            const own = bound.every((link) => {
                const shape = this.shapes.get(link.statePath);
                return shape !== undefined && ownState(shape, link.key);
            });
            if (!own) continue;
            const first = bound[0] as Link;
            this.errors.push(buildError('SUI-LINK-OWN', { target, name: first.key, path: first.statePath, statePath: first.statePath }));
        }
    }

    /** Checks the `<-` properties of the tree: syntax, node references, and that each `$.data` target exists */
    checkLinks(root: Node): void {
        const extracted = extractLinks(root, { path: this.rootPath, library: this.library, instances: this.instances });
        this.errors.push(...extracted.errors);
        this.checkOwnState(extracted.links);
        for (const link of extracted.links) {
            if (DATA_TARGET.test(link.target) && !dataPathExists(this.data, link.target)) {
                this.errors.push(
                    buildError('SUI-LINK-MISSING', { target: link.target, path: link.statePath, statePath: link.statePath })
                );
            }
        }
    }
}

/**
 * Checks one resolved tree: each node against its component's shape (`validateNode`, with `$row` legal only inside
 * a `row: true` slot) and every `<-` link. `data` is the document's data branch, which `$.data` targets must reach
 */
export function checkTree(
    root: Node,
    instances: Readonly<Record<string, string[]>>,
    rootPath: string,
    library: ComponentLibrary,
    data: JsonValue | undefined,
    options: ValidateDocumentOptions
): BuildError[] {
    const checker = new TreeChecker(library, instances, rootPath, data, options);
    checker.visit(root, rootPath, false);
    checker.checkLinks(root);
    return checker.errors;
}
