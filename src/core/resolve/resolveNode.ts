import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { buildDefaults } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import { RESERVED_KEYS } from '../types.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import { cloneJson, isNodeValue, isObject, mergeValues } from './merge.js';
import type { ComponentLibrary, DocumentComposed, LibraryEntry, ResolveOptions, ResolveResult } from './types.js';

/** The key of a composed file that lists the paths it intends to be overridden; it is metadata, never state */
const EXPOSES = 'exposes';

const ROOT_PATH = '$.app';

function has(record: object, name: string): boolean {
    return Object.hasOwn(record, name);
}

/** The document's composed entries come first; the library is the fallback */
function lookup(name: string, library: ComponentLibrary, composed: DocumentComposed): LibraryEntry | undefined {
    if (has(composed, name)) return { tier: 'composed', tree: composed[name] as Node };
    return has(library, name) ? library[name] : undefined;
}

/** Every component name used anywhere inside a value, in document order */
function referencedNames(value: JsonValue, found: string[] = []): string[] {
    if (Array.isArray(value)) {
        for (const item of value) referencedNames(item, found);
    } else if (isObject(value)) {
        if (typeof value[RESERVED_KEYS.component] === 'string') found.push(value[RESERVED_KEYS.component] as string);
        for (const item of Object.values(value)) referencedNames(item, found);
    }
    return found;
}

/** Finds a composed component that contains itself through default trees; returns the chain or undefined */
function findCycle(start: string, library: ComponentLibrary, composed: DocumentComposed): string[] | undefined {
    const done = new Set<string>();
    const stack: string[] = [];
    const visit = (name: string): string[] | undefined => {
        const index = stack.indexOf(name);
        if (index >= 0) return [...stack.slice(index), name];
        if (done.has(name)) return undefined;
        const entry = lookup(name, library, composed);
        if (entry?.tier !== 'composed') return undefined;
        stack.push(name);
        for (const next of referencedNames(entry.tree)) {
            const cycle = visit(next);
            if (cycle) return cycle;
        }
        stack.pop();
        done.add(name);
        return undefined;
    };
    return visit(start);
}

class Resolver {
    readonly errors: BuildError[] = [];
    readonly instances: Record<string, string[]> = {};

    constructor(
        private readonly library: ComponentLibrary,
        private readonly composed: DocumentComposed
    ) {}

    /** The shape of a root component; a composed one has none until it is expanded */
    private readonly shapeOf = (component: string): Shape | undefined => {
        const entry = lookup(component, this.library, this.composed);
        return entry?.tier === 'root' ? entry.shape : undefined;
    };

    /** `names` are the composed components expanded so far at this path */
    resolve(node: JsonValue, path: string, names: readonly string[] = []): JsonValue {
        if (!isNodeValue(node)) {
            this.errors.push(buildError('SUI-NODE-UNKNOWN', { component: '(none)', path, statePath: path }));
            return cloneJson(node);
        }

        const name = node.component;
        const entry = lookup(name, this.library, this.composed);
        if (!entry) {
            this.errors.push(buildError('SUI-NODE-UNKNOWN', { component: name, path, statePath: path }));
            return cloneJson(node);
        }

        if (entry.tier === 'root') return this.resolveRoot(node, entry.shape, path);

        const cycle = findCycle(name, this.library, this.composed);
        if (cycle) {
            const error = buildError('SUI-NODE-CYCLE', { component: cycle.join(' > '), path, statePath: path });
            error.component = name;
            this.errors.push(error);
            return cloneJson(node);
        }

        const tree: JsonObject = { ...entry.tree };
        delete tree[EXPOSES];
        const overrides: JsonObject = { ...node };
        delete overrides[RESERVED_KEYS.component];
        const merged = mergeValues(tree, overrides, false, this.shapeOf);
        const chain = [...names, name];
        this.instances[path] = chain;
        return this.resolve(merged, path, chain);
    }

    private resolveRoot(node: Node, shape: Shape, path: string): JsonValue {
        const merged = mergeValues(buildDefaults(shape), node, false, this.shapeOf, shape) as JsonObject;
        const result: JsonObject = {};
        for (const [key, value] of Object.entries(merged)) {
            if (key === RESERVED_KEYS.children && isObject(value)) {
                const children: JsonObject = {};
                for (const [childKey, child] of Object.entries(value)) {
                    children[childKey] = isNodeValue(child) ? this.resolve(child, `${path}.${key}.${childKey}`) : child;
                }
                result[key] = children;
            } else if (shape.properties[key]?.type === 'node' && isNodeValue(value)) {
                result[key] = this.resolve(value, `${path}.${key}`);
            } else if (typeof shape.properties[key]?.items === 'object' && isObject(value)) {
                result[key] = this.resolveItems(value, `${path}.${key}`);
            } else {
                result[key] = value;
            }
        }
        return result;
    }

    /** The node fields of the items of a map (a table column's `cell`) are nodes too: resolve each one */
    private resolveItems(map: JsonObject, path: string): JsonObject {
        const result: JsonObject = {};
        for (const [mapKey, entry] of Object.entries(map)) {
            if (!isObject(entry)) {
                result[mapKey] = entry;
                continue;
            }
            const item: JsonObject = {};
            for (const [field, fieldValue] of Object.entries(entry)) {
                item[field] = isNodeValue(fieldValue) ? this.resolve(fieldValue, `${path}.${mapKey}.${field}`) : fieldValue;
            }
            result[mapKey] = item;
        }
        return result;
    }
}

/** Collision errors for document composed names that are also library names; the library name stays reserved */
export function checkComposedNames(library: ComponentLibrary, composed: DocumentComposed): BuildError[] {
    return Object.keys(composed)
        .filter((name) => has(library, name))
        .map((name) => {
            const path = `$.composed.${name}`;
            return buildError('SUI-DOC-COMPOSED', { name, path, statePath: path });
        });
}

/**
 * Turns a node into one merged, fully resolved tree. A root component's node is merged over the shape's
 * defaults; a composed component's node is merged over its default tree, its values addressing nested nodes
 * by path. Every nested node (`children` and node-typed slots) is then resolved the same way, so composed
 * components inside composed components work. `composed` is the document's own composed entries; they win over
 * the library, and a name that is also a library name is a `SUI-DOC` error.
 *
 * Pure: the inputs are never changed and the result shares nothing with them. It never throws on a bad
 * tree; problems come back in `errors`
 */
export function resolveNode(
    node: Node,
    library: ComponentLibrary,
    composed: DocumentComposed = {},
    options: ResolveOptions = {}
): ResolveResult {
    const resolver = new Resolver(library, composed);
    const errors = checkComposedNames(library, composed);
    const resolved = resolver.resolve(node, options.path ?? ROOT_PATH);
    return { node: resolved as Node, errors: [...errors, ...resolver.errors], instances: resolver.instances };
}
