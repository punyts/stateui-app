import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { parseTarget, resolveTarget } from '../on/index.js';
import type { Frame, TreeNode } from '../on/index.js';
import { peersPath } from '../meta/metadataPaths.js';
import { entryShape } from '../resolve/index.js';
import { isNodeValue, isObject } from '../resolve/merge.js';
import { nodeChildren } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import { PREFIXES, RESERVED_KEYS } from '../types.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import { runtimePath } from './runtimePath.js';
import type { ExtractOptions, ExtractResult, Link, RowLinkOptions } from './types.js';

const ROOT_PATH = '$.app';
const SEGMENT = '[A-Za-z0-9_-]+';
const DATA_TARGET = new RegExp(`^\\$\\.data(\\.${SEGMENT})*$`);
/** The sync status the host writes (`$.runtime.sync`): an app links a badge to it */
const SYNC_TARGET = /^\$\.runtime\.sync(\.(mode|status|waiting))?$/;
/** The requests that wait for the owner, which the host writes (`$.runtime.requests`): an app lists them */
const REQUESTS_TARGET = /^\$\.runtime\.requests$/;
const ROW_TARGET = new RegExp(`^\\$row(\\.${SEGMENT})*$`);
const NODE_REFERENCE = new RegExp(`^(#${SEGMENT}|)(\\.${SEGMENT})+$`);
/** `$peers` and a node reference: what the peers of a shared branch have there (`$peers.mousePosition`) */
const PEERS_TARGET = new RegExp(`^\\$peers(#${SEGMENT}|)(\\.${SEGMENT})+$`);
const PEERS_ROOT = '$peers';
/** `$.server` and the paths below it: server-only, so never a link target */
const SERVER_TARGET = /^\$\.server(\.|$)/;

/** True for a target a link may have: `$.data`, `$row`, `$.runtime.sync`, `$.runtime.requests`, a node reference (`#name.path`, `.path`) or `$peers` and one */
function isLinkTarget(target: string): boolean {
    return PEERS_TARGET.test(target) || DATA_TARGET.test(target) || ROW_TARGET.test(target) || SYNC_TARGET.test(target) || REQUESTS_TARGET.test(target) || NODE_REFERENCE.test(target);
}

/** The shape of a root component, if the library has one */
function shapeOf(options: ExtractOptions, component: string): Shape | undefined {
    const library = options.library;
    if (library === undefined || !Object.hasOwn(library, component)) return undefined;
    const entry = library[component];
    return entryShape(entry);
}

class Extractor {
    readonly links: Link[] = [];
    readonly errors: BuildError[] = [];
    /** The nodes from the root of the tree down to the one being walked */
    private readonly frames: Frame[] = [];
    /** The index in `frames` of the node that owns the row template being walked, when inside one */
    private rowOwner: number | undefined;
    /** The state paths of the row templates found so far */
    private readonly rowPaths = new Set<string>();

    constructor(private readonly options: ExtractOptions) {}

    /** Copies a value, removing every `<-` property and recording it. `on` entries are left as written */
    walk(value: JsonValue, path: string): JsonValue {
        if (Array.isArray(value)) return value.map((item, index) => this.walk(item, `${path}.${index}`));
        if (!isObject(value)) return value;

        const outerOwner = this.rowOwner;
        const isNode = isNodeValue(value);
        if (isNode) this.enter(value as TreeNode, path);
        const copy: JsonObject = {};
        for (const [key, item] of Object.entries(value)) {
            if (key.startsWith(PREFIXES.link)) {
                this.record(path, key.slice(PREFIXES.link.length), item);
            } else if (key === RESERVED_KEYS.on) {
                copy[key] = item;
            } else {
                copy[key] = this.walk(item, `${path}.${key}`);
            }
        }
        if (isNode) this.frames.pop();
        this.rowOwner = outerOwner;
        return copy;
    }

    /** Pushes the node's frame and notes which of its slots are row templates */
    enter(node: TreeNode, path: string): void {
        if (this.rowPaths.has(path)) this.rowOwner = this.frames.length - 1;
        const instances = this.options.instances;
        this.frames.push({
            path,
            key: path.slice(path.lastIndexOf('.') + 1),
            node,
            instances: instances !== undefined && Object.hasOwn(instances, path) ? (instances[path] as string[]) : []
        });
        for (const child of nodeChildren(node, path, shapeOf(this.options, node.component))) {
            if (child.row) this.rowPaths.add(child.path);
        }
    }

    /**
     * A node reference as a state path. An exposed runtime property gives its runtime path (`#orders.current.customer`
     * gives `$.runtime.nodes.app.…orders.current.customer`); a stored property its node's state path (`#notes.value`
     * gives `$.screens.home.…notes.value`). Relative references resolve against the owner of the row template they sit
     * in, not the slot. Undefined when the node does not exist or its shape has no such property, or the property is
     * content or a runtime property it does not expose. Without a library the reference stays as written
     */
    private reference(target: string): { target: string; exposed?: string; stored?: true } | undefined {
        if (this.options.library === undefined) return { target };
        const parsed = parseTarget(target);
        const chain =
            this.options.owner ?? (this.rowOwner === undefined ? this.frames : this.frames.slice(0, this.rowOwner + 1));
        const located = parsed ? resolveTarget(parsed, chain, chain[0]?.path ?? ROOT_PATH) : undefined;
        if (located?.kind !== 'property') return undefined;
        const property = shapeOf(this.options, located.node.component)?.properties[located.property];
        if (property === undefined || property.kind === 'content') return undefined;
        if (property.exposed) {
            const exposed = `${runtimePath(located.path)}.${located.property}`;
            return { target: [exposed, ...located.rest].join('.'), exposed };
        }
        // A stored property (a field's value, a screen's filter) links to the node's own state path
        if (property.runtime) return undefined;
        return { target: [`${located.path}.${located.property}`, ...located.rest].join('.'), stored: true };
    }

    /**
     * A `$peers` link: the reference after `$peers` must reach a stored property, and the link reads the map of what
     * its peers have there, `$.peers.<path>` (`peersPath`), which the host writes. Missing until it does
     */
    private peers(path: string, key: string, target: string): void {
        if (this.options.library === undefined) {
            this.links.push({ statePath: path, key, target });
            return;
        }
        const resolved = this.reference(target.slice(PEERS_ROOT.length));
        if (resolved?.stored !== true) {
            this.errors.push(buildError('SUI-LINK-MISSING', { target, path, statePath: path }));
            return;
        }
        this.links.push({ statePath: path, key, target: peersPath(resolved.target), allowMissing: true });
    }

    private record(path: string, key: string, target: JsonValue): void {
        if (key === '') {
            this.errors.push(buildError('SUI-NODE-NAME', { name: PREFIXES.link, path, statePath: path }));
            return;
        }
        if (typeof target === 'string' && SERVER_TARGET.test(target)) {
            this.errors.push(buildError('SUI-LINK-SERVER', { key, target, path, statePath: path }));
            return;
        }
        if (typeof target !== 'string' || !isLinkTarget(target)) {
            const shown = typeof target === 'string' ? target : `(${target === null ? 'null' : typeof target})`;
            this.errors.push(buildError('SUI-LINK-TARGET', { key, target: shown, path, statePath: path }));
            return;
        }
        if (DATA_TARGET.test(target) || ROW_TARGET.test(target) || SYNC_TARGET.test(target)) {
            this.links.push({ statePath: path, key, target });
            return;
        }
        if (PEERS_TARGET.test(target)) {
            this.peers(path, key, target);
            return;
        }
        const resolved = this.reference(target);
        if (resolved === undefined) {
            this.errors.push(buildError('SUI-LINK-MISSING', { target, path, statePath: path }));
            return;
        }
        // The component creates the exposed property after links are applied, and a stored property the definition
        // leaves unset has no value yet, so the target may not exist
        this.links.push({
            statePath: path,
            key,
            target: resolved.target,
            ...(resolved.exposed === undefined ? {} : { allowMissing: true, exposed: resolved.exposed }),
            ...(resolved.stored === true ? { allowMissing: true } : {})
        });
    }
}

/**
 * Collects every `<-key` property of a resolved tree and returns the tree without them. A target must start
 * with `$.data` or `$row`, or be a node reference (`#name.path`, `.path`) to an exposed runtime property;
 * anything else (`..x`, `$.app…`) is `SUI-LINK-TARGET`.
 *
 * With `options.library` a node reference is resolved against the tree: an exposed runtime property to its runtime
 * path (`#orders.current` gives `$.runtime.nodes.app.…orders.current`), a stored property to the node's state path
 * (`#notes.value`); a node that does not exist, or whose shape has no such property (or it is content, or a runtime
 * property it does not expose), is `SUI-LINK-MISSING`. A resolved reference carries `allowMissing`, and an exposed one
 * `exposed`, since the component creates the property after links are applied (see `applyLinks`). Inside a row template relative references resolve
 * against the node that owns the template. Without a library node references are returned as written. `$row` targets are returned
 * as written: `resolveRowLinks` points them at the slot. Pure; never throws on a bad tree
 */
export function extractLinks(resolvedTree: Node, options: ExtractOptions = {}): ExtractResult {
    const extractor = new Extractor(options);
    for (const ancestor of options.ancestors ?? []) extractor.enter(ancestor.node as TreeNode, ancestor.path);
    const tree = extractor.walk(resolvedTree, options.path ?? ROOT_PATH) as Node;
    return {
        tree,
        links: extractor.links,
        linkedPaths: extractor.links.map((link) => `${link.statePath}.${link.key}`),
        errors: extractor.errors
    };
}

/**
 * The links of one record-view slot. `$row` targets are rewritten to the slot's `row` alias path, so with
 * `rowPath` `$.runtime.nodes.app.orders.slots.3.row` the target `$row.customer` becomes
 * `$.runtime.nodes.app.orders.slots.3.row.customer`. Those links are fixed aliases created once per slot with
 * `allowMissing`: a missing field reads as `undefined` and updates when it appears. Only `row` is ever
 * re-pointed. Node references resolve like in `extractLinks`; pass `owner` (the chain of the record view, the view
 * last) so they resolve against it and not against the slot's own nodes. Other targets are returned as written
 */
export function resolveRowLinks(rowNode: Node, rowPath: string, options: RowLinkOptions = {}): ExtractResult {
    const result = extractLinks(rowNode, { ...options, path: options.path ?? rowPath.slice(0, rowPath.lastIndexOf('.')) });
    const links = result.links.map((link): Link => {
        if (!ROW_TARGET.test(link.target)) return link;
        return { ...link, target: `${rowPath}${link.target.slice('$row'.length)}`, allowMissing: true };
    });
    return { ...result, links };
}
