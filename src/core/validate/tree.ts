import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { extractLinks } from '../links/index.js';
import { entryShape } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { nodeChildren, validateNode } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { JsonValue, Node } from '../types.js';
import { dataPathExists } from './document.js';
import type { ValidateDocumentOptions } from './types.js';

const DATA_TARGET = /^\$\.data(\.|$)/;

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
        if (shape) this.addNodeErrors(validateNode(shape, withoutRuntimeDefaults(shape, node), path, { ...this.options, insideRow }));
        for (const child of nodeChildren(node, path, shape)) {
            const refused = childRefusal(this.library, child.node.component, child.accepts);
            if (refused !== undefined) this.errors.push(refused(child.path));
            this.visit(child.node as Node, child.path, insideRow || child.row);
        }
    }

    /** Checks the `<-` properties of the tree: syntax, node references, and that each `$.data` target exists */
    checkLinks(root: Node): void {
        const extracted = extractLinks(root, { path: this.rootPath, library: this.library, instances: this.instances });
        this.errors.push(...extracted.errors);
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
