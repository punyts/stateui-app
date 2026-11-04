import { isNodeValue, isObject } from '../resolve/merge.js';
import type { JsonValue } from '../types.js';
import type { Frame, Located, ParsedTarget, TreeNode } from './types.js';

const APP_STEP = 'app';

/**
 * Walks `segments` down from a node. A step is a slot (a node-typed property), the `children` map or a child key;
 * the first step that is not one of these names a property of the node it left, and the walk stops there
 */
function walk(start: TreeNode, startPath: string, segments: readonly string[]): Located | undefined {
    let current: JsonValue = start;
    let node: TreeNode = start;
    let path = startPath;

    for (const [index, step] of segments.entries()) {
        const next: JsonValue | undefined = isObject(current) && Object.hasOwn(current, step) ? current[step] : undefined;
        if (isNodeValue(current)) {
            if (isNodeValue(next)) {
                current = next;
                node = next;
            } else if (step === 'children' && isObject(next)) {
                current = next;
            } else {
                return { kind: 'property', path, node: current, property: step, rest: segments.slice(index + 1) };
            }
        } else {
            if (!isNodeValue(next)) return undefined;
            current = next;
            node = next;
        }
        path = `${path}.${step}`;
    }

    return isNodeValue(current) ? { kind: 'node', path, node } : undefined;
}

/** Every node below `node` (itself included) whose key is `name`: slot properties and `children` entries */
function nodesNamed(node: TreeNode, path: string, key: string, name: string, found: { node: TreeNode; path: string }[]): void {
    if (key === name) found.push({ node, path });
    for (const [property, value] of Object.entries(node)) {
        if (isNodeValue(value)) nodesNamed(value, `${path}.${property}`, property, name, found);
        else if (property === 'children' && isObject(value)) {
            for (const [child, item] of Object.entries(value)) {
                if (isNodeValue(item)) nodesNamed(item, `${path}.children.${child}`, child, name, found);
            }
        }
    }
}

/**
 * Resolves a parsed target against the resolved tree. `chain` runs from the root of the validated tree down to the
 * node that holds the `on` entry (which is its last frame); `rootPath` is the state path of the first frame.
 *
 * - Named node: the nearest frame, the node itself included, whose key is `name` or whose `instances` list
 *   `name`; when no ancestor has the name, the one node of the tree with that key (a sibling's form, a drawer
 *   elsewhere). Then the steps below it.
 * - Own subtree: the steps below the node itself.
 * - Absolute: `$.app...` is walked from the root; any other `$.` path is `state` and not checked.
 * - `$row`: the record of a row template. `rowPath` is the path of the slot's `row` alias (the dispatcher) or any
 *   marker (the validator); without it the target is outside a row template and does not resolve. The result is
 *   `state`, so nothing is checked below it
 * - `$parent` needs the command, so it is not resolved here (see `findProvider`); it returns undefined
 *
 * Returns undefined when the ancestor or any step does not exist
 */
export function resolveTarget(
    target: ParsedTarget,
    chain: readonly Frame[],
    rootPath: string,
    rowPath?: string
): Located | undefined {
    const self = chain[chain.length - 1];
    const root = chain[0];
    if (!self || !root) return undefined;

    if (target.form === 'parent') return undefined;
    if (target.form === 'row') {
        if (rowPath === undefined) return undefined;
        return { kind: 'state', path: [rowPath, ...target.segments].join('.') };
    }
    if (target.form === 'own') return walk(self.node, self.path, target.segments);

    if (target.form === 'named') {
        for (let index = chain.length - 1; index >= 0; index -= 1) {
            const frame = chain[index] as Frame;
            if (frame.key === target.name || frame.instances.includes(target.name)) {
                return walk(frame.node, frame.path, target.segments);
            }
        }
        const found: { node: TreeNode; path: string }[] = [];
        nodesNamed(root.node, root.path, root.key, target.name, found);
        return found.length === 1 ? walk((found[0] as { node: TreeNode }).node, (found[0] as { path: string }).path, target.segments) : undefined;
    }

    const path = `$.${target.segments.join('.')}`;
    if (target.segments[0] !== APP_STEP) return { kind: 'state', path };
    if (path === rootPath) return walk(root.node, rootPath, []);
    if (!path.startsWith(`${rootPath}.`)) return { kind: 'outside', path };
    return walk(root.node, rootPath, path.slice(rootPath.length + 1).split('.'));
}

/**
 * A command aimed at `$row` is handled by the node that owns the row template: the nearest frame of `chain` (the
 * owner's chain, the owner last) for which `declares` is true
 */
export function findRowProvider(chain: readonly Frame[], declares: (frame: Frame) => boolean): Frame | undefined {
    for (let index = chain.length - 1; index >= 0; index -= 1) {
        const frame = chain[index] as Frame;
        if (declares(frame)) return frame;
    }
    return undefined;
}

/** `$parent`: the nearest ancestor (not the node itself) for which `declares` is true */
export function findProvider(chain: readonly Frame[], declares: (frame: Frame) => boolean): Frame | undefined {
    for (let index = chain.length - 2; index >= 0; index -= 1) {
        const frame = chain[index] as Frame;
        if (declares(frame)) return frame;
    }
    return undefined;
}
