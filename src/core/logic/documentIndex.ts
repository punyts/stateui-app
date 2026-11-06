import { parseTarget, resolveTarget } from '../on/index.js';
import type { Frame, ResolvedTree, TreeNode } from '../on/index.js';
import { entryShape } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { cloneJson, isNodeValue, isObject } from '../resolve/merge.js';
import { nodeChildren } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import { RESERVED_KEYS } from '../types.js';
import type { JsonObject, JsonValue } from '../types.js';
import { covers } from './working.js';
import { pathSteps } from './pattern.js';

const FORM = 'form';
const FIELD = /Field$/;

/** What hosts need from the document to run logic: node references, form fields and the values `reset` writes */
export interface LogicIndex {
    /** `^name.path` as a state path: the one node whose key or composed name is `name`, then the steps below it */
    resolve(reference: string): string | undefined;
    /** Why a reference does not resolve: no node has the name, or several do (with their paths) */
    explain(reference: string): string | undefined;
    /** The fields of the `form` node at a path: child key to the state path of the field's value */
    fields(path: string): Record<string, string> | undefined;
    /** The document's value at a `$.app` or `$.data` path, with the shape defaults of every node (runtime properties left out) */
    initial(path: string): JsonValue | undefined;
    /** The property a record view at a path takes its records in (`records`, or `items` for a list, table or tree) */
    records(path: string): string | undefined;
}

/** The screens a logic index covers beside the shell, and the screen `$.route` shows now */
export interface LogicIndexScreens {
    /** Each screen's resolved root, by screen name; its nodes have the paths `$.screens.{screen}...` */
    trees: Readonly<Record<string, ResolvedTree>>;
    /** The current screen (`$.route.screen`); undefined when unknown, as while validating */
    current?(): string | undefined;
}

/** The properties a record view takes its records in, in the order they are tried */
const RECORD_PROPERTIES = ['records', 'items'];

function shapeOf(library: ComponentLibrary, component: string): Shape | undefined {
    const entry = library[component];
    return entryShape(entry);
}

function walkValue(value: JsonValue | undefined, steps: readonly string[]): JsonValue | undefined {
    let current = value;
    for (const step of steps) {
        if (!isObject(current) && !Array.isArray(current)) return undefined;
        current = (current as Record<string, JsonValue>)[step];
    }
    return current;
}

/** The screen a state path belongs to, or undefined for the shell */
function screenOf(path: string): string | undefined {
    return path.startsWith('$.screens.') ? path.split('.')[2] : undefined;
}

/**
 * Indexes the resolved `app` tree (`resolveNode`) once, and each screen's tree when `screens` is given. Logic has no
 * position in the tree, so a name must be unique where it is looked up: in the current screen first, then in the
 * shell. Without a current screen (while validating) a name unique in the shell wins, then a name unique among all
 * screens. A reference whose name matches no node, or several in the same place, does not resolve
 */
export function createLogicIndex(tree: ResolvedTree, library: ComponentLibrary, data?: JsonValue, screens?: LogicIndexScreens): LogicIndex {
    const frames = new Map<string, Frame>();
    const roots: { tree: ResolvedTree; path: string }[] = [
        { tree, path: '$.app' },
        ...Object.entries(screens?.trees ?? {}).map(([name, screen]) => ({ tree: screen, path: `$.screens.${name}` }))
    ];
    for (const root of roots) {
        const stack: { node: TreeNode; path: string }[] = [{ node: root.tree.node, path: root.path }];
        while (stack.length > 0) {
            const { node, path } = stack.pop() as { node: TreeNode; path: string };
            frames.set(path, {
                path,
                key: path.slice(path.lastIndexOf('.') + 1),
                node,
                instances: Object.hasOwn(root.tree.instances, path) ? (root.tree.instances[path] as string[]) : []
            });
            for (const child of nodeChildren(node, path, shapeOf(library, node.component))) {
                if (!child.row) stack.push({ node: child.node as TreeNode, path: child.path });
            }
        }
    }

    const withDefaults = (node: TreeNode): JsonObject => {
        const shape = shapeOf(library, node.component);
        const value: JsonObject = {};
        for (const [name, property] of Object.entries(shape?.properties ?? {})) {
            if (!property.runtime && property.default !== undefined) value[name] = cloneJson(property.default);
        }
        for (const [key, item] of Object.entries(node)) {
            if (key === RESERVED_KEYS.on || shape?.properties[key]?.runtime === true) continue;
            if (isNodeValue(item)) {
                value[key] = withDefaults(item as TreeNode);
            } else if (key === RESERVED_KEYS.children && isObject(item)) {
                const children: JsonObject = {};
                for (const [childKey, child] of Object.entries(item)) {
                    children[childKey] = isNodeValue(child) ? withDefaults(child as TreeNode) : cloneJson(child);
                }
                value[key] = children;
            } else {
                value[key] = cloneJson(item);
            }
        }
        return value;
    };

    const allNamed = (name: string): Frame[] => [...frames.values()].filter((frame) => frame.key === name || frame.instances.includes(name));

    /** The frames a name means: those of the first place (current screen, shell, all screens) that has any */
    const namedFrames = (name: string): Frame[] => {
        const named = allNamed(name);
        const current = screens?.current?.();
        const places =
            current === undefined
                ? [named.filter((frame) => screenOf(frame.path) === undefined), named.filter((frame) => screenOf(frame.path) !== undefined)]
                : [named.filter((frame) => screenOf(frame.path) === current), named.filter((frame) => screenOf(frame.path) === undefined)];
        return places.find((place) => place.length > 0) ?? [];
    };

    return {
        explain(reference) {
            const parsed = parseTarget(reference);
            if (parsed?.form !== 'named') return 'it is not a node reference (^name or ^name.path)';
            const named = namedFrames(parsed.name);
            if (named.length === 0) return `no node is named "${parsed.name}"`;
            if (named.length > 1) {
                const paths = named.map((frame) => frame.path).sort();
                return `${named.length} nodes are named "${parsed.name}": ${paths.join(', ')}; rename one or use a state path`;
            }
            return `"${reference.slice(parsed.name.length + 1)}" is not a path below node ${(named[0] as Frame).path}`;
        },
        resolve(reference) {
            const parsed = parseTarget(reference);
            if (parsed?.form !== 'named') return undefined;
            const named = namedFrames(parsed.name);
            if (named.length !== 1) return undefined;
            const located = resolveTarget(parsed, named, (named[0] as Frame).path);
            if (located?.kind === 'node') return located.path;
            if (located?.kind === 'property') return [located.path, located.property, ...located.rest].join('.');
            return undefined;
        },
        fields(path) {
            const form = frames.get(path);
            if (form?.node.component !== FORM) return undefined;
            const fields: Record<string, string> = {};
            const visit = (node: TreeNode, at: string): void => {
                for (const child of nodeChildren(node, at, shapeOf(library, node.component))) {
                    if (child.row || child.node.component === FORM) continue;
                    if (FIELD.test(child.node.component)) {
                        const shape = shapeOf(library, child.node.component);
                        const property = shape && !Object.hasOwn(shape.properties, 'value') && Object.hasOwn(shape.properties, 'checked') ? 'checked' : 'value';
                        fields[child.path.slice(child.path.lastIndexOf('.') + 1)] = `${child.path}.${property}`;
                    } else {
                        visit(child.node as TreeNode, child.path);
                    }
                }
            };
            visit(form.node, path);
            return fields;
        },
        records(path) {
            const node = frames.get(path)?.node;
            const shape = node === undefined ? undefined : shapeOf(library, node.component);
            return shape === undefined ? undefined : RECORD_PROPERTIES.find((name) => Object.hasOwn(shape.properties, name));
        },
        initial(path) {
            if (covers('$.data', path)) {
                const value = walkValue(data, pathSteps(path).slice(1));
                return value === undefined ? undefined : cloneJson(value);
            }
            let deepest: Frame | undefined;
            for (const frame of frames.values()) {
                if (covers(frame.path, path) && (!deepest || frame.path.length > deepest.path.length)) deepest = frame;
            }
            if (!deepest) return undefined;
            return walkValue(withDefaults(deepest.node), pathSteps(path).slice(pathSteps(deepest.path).length));
        }
    };
}
