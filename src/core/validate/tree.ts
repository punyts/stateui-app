import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { extractLinks } from '../links/index.js';
import type { Link } from '../links/index.js';
import { parseTarget, resolveTarget } from '../on/index.js';
import type { Frame } from '../on/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { isNodeValue, isObject } from '../resolve/merge.js';
import { validateNode } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import { RESERVED_KEYS } from '../types.js';
import type { JsonValue, Node } from '../types.js';
import { dataPathExists } from './document.js';
import type { ValidateDocumentOptions } from './types.js';

const DATA_TARGET = /^\$\.data(\.|$)/;
const ROW_TARGET = /^\$row(\.|$)/;

function shapeOf(library: ComponentLibrary, component: string): Shape | undefined {
    if (!Object.hasOwn(library, component)) return undefined;
    const entry = library[component];
    return entry?.tier === 'root' ? entry.shape : undefined;
}

class TreeChecker {
    readonly errors: BuildError[] = [];
    /** The chain of frames from the root to each node, by node path */
    private readonly chains = new Map<string, Frame[]>();

    constructor(
        private readonly library: ComponentLibrary,
        private readonly instances: Readonly<Record<string, string[]>>,
        private readonly rootPath: string,
        private readonly data: JsonValue | undefined,
        private readonly options: ValidateDocumentOptions
    ) {}

    /** Checks every node against its shape and records the chain of each */
    visit(node: Node, path: string, parents: readonly Frame[], insideRow: boolean): void {
        const frame: Frame = {
            path,
            key: path.slice(path.lastIndexOf('.') + 1),
            node,
            instances: Object.hasOwn(this.instances, path) ? (this.instances[path] as string[]) : []
        };
        const chain = [...parents, frame];
        this.chains.set(path, chain);

        const shape = shapeOf(this.library, node.component);
        if (shape) this.errors.push(...validateNode(shape, node, path, { ...this.options, insideRow }));

        for (const [key, value] of Object.entries(node)) {
            if (key === RESERVED_KEYS.on || key === RESERVED_KEYS.component) continue;
            if (key === RESERVED_KEYS.children && isObject(value)) {
                for (const [childKey, child] of Object.entries(value)) {
                    if (isNodeValue(child)) this.visit(child, `${path}.${key}.${childKey}`, chain, insideRow);
                }
            } else if (isNodeValue(value)) {
                const row = Object.hasOwn(shape?.properties ?? {}, key) && shape?.properties[key]?.row === true;
                this.visit(value, `${path}.${key}`, chain, insideRow || row);
            }
        }
    }

    /** The chain of the node that holds a link: the longest node path that is a prefix of the link's path */
    private ownerChain(statePath: string): Frame[] | undefined {
        let path = statePath;
        while (path !== '') {
            const chain = this.chains.get(path);
            if (chain) return chain;
            const cut = path.lastIndexOf('.');
            path = cut < 0 ? '' : path.slice(0, cut);
        }
        return undefined;
    }

    /** Checks the `<-` properties of the tree: syntax, existence of each target, and loops among node references */
    checkLinks(root: Node): void {
        const extracted = extractLinks(root, { path: this.rootPath });
        this.errors.push(...extracted.errors);

        /** The linked property path to the property path it points at, for node references */
        const edges = new Map<string, { to: string; link: Link }>();
        for (const link of extracted.links) {
            if (ROW_TARGET.test(link.target)) continue;
            if (DATA_TARGET.test(link.target)) {
                if (!dataPathExists(this.data, link.target)) this.missing(link);
                continue;
            }

            const chain = this.ownerChain(link.statePath);
            const parsed = parseTarget(link.target);
            const located = chain && parsed ? resolveTarget(parsed, chain, this.rootPath) : undefined;
            if (located?.kind !== 'property' || !this.declares(located.node.component, located.property)) {
                this.missing(link);
                continue;
            }
            edges.set(`${link.statePath}.${link.key}`, { to: `${located.path}.${located.property}`, link });
        }
        this.checkLoops(edges);
    }

    private declares(component: string, property: string): boolean {
        const shape = shapeOf(this.library, component);
        return shape === undefined || Object.hasOwn(shape.properties, property);
    }

    private missing(link: Link): void {
        this.errors.push(
            buildError('SUI-LINK-MISSING', { target: link.target, path: link.statePath, statePath: link.statePath })
        );
    }

    /** Each property has one link, so the links form chains; one that returns to a property seen before is a loop */
    private checkLoops(edges: ReadonlyMap<string, { to: string; link: Link }>): void {
        const done = new Set<string>();
        for (const start of edges.keys()) {
            const walked = new Set<string>();
            let current: string | undefined = start;
            while (current !== undefined && !done.has(current)) {
                if (walked.has(current)) {
                    const { link } = edges.get(current) as { link: Link };
                    this.errors.push(
                        buildError('SUI-LINK-CYCLE', { target: link.target, path: link.statePath, statePath: link.statePath })
                    );
                    break;
                }
                walked.add(current);
                current = edges.get(current)?.to;
            }
            for (const path of walked) done.add(path);
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
    checker.visit(root, rootPath, [], false);
    checker.checkLinks(root);
    return checker.errors;
}
