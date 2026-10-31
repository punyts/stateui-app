import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { extractLinks } from '../links/index.js';
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
    return entry?.tier === 'root' ? entry.shape : undefined;
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

    /** Checks every node against its shape; `insideRow` is true inside a `row: true` slot, where `$row` is legal */
    visit(node: Node, path: string, insideRow: boolean): void {
        const shape = shapeOf(this.library, node.component);
        if (shape) this.errors.push(...validateNode(shape, withoutRuntimeDefaults(shape, node), path, { ...this.options, insideRow }));
        for (const child of nodeChildren(node, path, shape)) {
            if (child.accepts !== undefined && !child.accepts.includes(child.node.component)) {
                this.errors.push(
                    buildError('SUI-NODE-CHILD', {
                        component: child.node.component,
                        path: child.path,
                        statePath: child.path,
                        other: child.accepts.join(', ')
                    })
                );
            }
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
