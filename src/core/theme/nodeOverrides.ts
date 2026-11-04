import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { resolveNode } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { isObject } from '../resolve/merge.js';
import { nodeChildren } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import { RESERVED_KEYS } from '../types.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import type { DocumentValidationContext } from '../validate/types.js';
import { DEFAULT_LEAVES, tokenLayer } from './defaults.js';
import { referencesOf } from './references.js';
import type { ComponentToken, TokenLayer, TokenType } from './types.js';
import { validateTokenValue } from './value.js';

const APP_PATH = '$.app';
const SEGMENT = /^[a-z0-9]+$/;

interface Override {
    path: string;
    statePath: string;
    value: JsonValue;
    /** The keys from `theme` down; a key with a dot or another character a token name cannot have is rejected */
    segments: readonly string[];
}

/** The type of every token a node may name: the default tree and the library's component tokens */
function typeTable(components: readonly ComponentToken[]): Map<string, TokenType | undefined> {
    const types = new Map<string, TokenType | undefined>();
    for (const leaf of DEFAULT_LEAVES) types.set(leaf.path, leaf.type);
    for (const token of components) types.set(token.path, token.type);
    return types;
}

/** The leaves of a node's `theme` object, each with the dotted token path and its state path */
function leavesOf(theme: JsonObject, base: string, prefix: readonly string[] = []): Override[] {
    const leaves: Override[] = [];
    for (const [key, value] of Object.entries(theme)) {
        const segments = [...prefix, key];
        if (isObject(value)) leaves.push(...leavesOf(value, `${base}.${key}`, segments));
        else leaves.push({ path: segments.join('.'), statePath: `${base}.${key}`, value, segments });
    }
    return leaves;
}

function refError(leaf: Override, target: string, reason: string): BuildError {
    return buildError('SUI-THEME-REF', { path: leaf.path, statePath: leaf.statePath, target, name: reason });
}

/** The reason a layer may not reference the layer of its target, or undefined when it may */
function directionReason(from: TokenLayer, to: TokenLayer): string | undefined {
    if (from === 'semantic' && to === 'component') return 'a semantic token cannot reference a component token';
    if (from === 'component' && to !== 'semantic') return 'a component token may only reference semantic tokens';
    return undefined;
}

/** A cycle among the references that the overrides of one node make with each other */
function cycleErrors(valid: readonly Override[]): BuildError[] {
    const byPath = new Map(valid.map((leaf) => [leaf.path, leaf]));
    const errors: BuildError[] = [];
    const state = new Map<string, 'open' | 'done'>();
    const stack: string[] = [];
    const visit = (path: string): void => {
        state.set(path, 'open');
        stack.push(path);
        const leaf = byPath.get(path) as Override;
        for (const next of typeof leaf.value === 'string' ? referencesOf(leaf.value) : []) {
            if (!byPath.has(next)) continue;
            const seen = state.get(next);
            if (seen === 'open') {
                const chain = [...stack.slice(stack.indexOf(next)), next];
                errors.push(refError(byPath.get(chain[0] as string) as Override, chain.join(' -> '), 'cycle'));
            } else if (seen === undefined) visit(next);
        }
        stack.pop();
        state.set(path, 'done');
    };
    for (const path of byPath.keys()) if (!state.has(path)) visit(path);
    return errors;
}

function checkTheme(
    node: Node,
    path: string,
    types: ReadonlyMap<string, TokenType | undefined>,
    errors: BuildError[]
): void {
    if (!Object.hasOwn(node, RESERVED_KEYS.theme)) return;
    const at = `${path}.${RESERVED_KEYS.theme}`;
    const theme = node[RESERVED_KEYS.theme] as JsonValue;
    if (!isObject(theme)) {
        errors.push(buildError('SUI-DOC-TYPE', { key: RESERVED_KEYS.theme, path: at, statePath: at }));
        return;
    }
    const typeOf = (token: string): TokenType | undefined => types.get(token);
    const accepted: Override[] = [];
    for (const leaf of leavesOf(theme, at)) {
        if (!leaf.segments.every((segment) => SEGMENT.test(segment)) || !types.has(leaf.path)) {
            errors.push(buildError('SUI-THEME-TOKEN', { path: leaf.path, statePath: leaf.statePath }));
            continue;
        }
        const layer = tokenLayer(leaf.path);
        if (layer === 'primitive') {
            errors.push(
                buildError('SUI-THEME-LAYER', {
                    name: leaf.path,
                    path: leaf.path,
                    component: node.component,
                    other: path,
                    statePath: leaf.statePath
                })
            );
            continue;
        }
        if (typeof leaf.value !== 'string') {
            errors.push(
                buildError('SUI-THEME-VALUE', { path: leaf.path, statePath: leaf.statePath, name: types.get(leaf.path) as TokenType })
            );
            continue;
        }
        const before = errors.length;
        for (const target of referencesOf(leaf.value)) {
            if (!types.has(target)) {
                errors.push(refError(leaf, target, 'no such token'));
                continue;
            }
            const reason = directionReason(layer, tokenLayer(target));
            if (reason !== undefined) errors.push(refError(leaf, target, reason));
        }
        if (errors.length > before) continue;
        const type = types.get(leaf.path) as TokenType;
        if (!validateTokenValue(type, leaf.value, typeOf)) {
            errors.push(buildError('SUI-THEME-VALUE', { path: leaf.path, statePath: leaf.statePath, name: type }));
            continue;
        }
        accepted.push(leaf);
    }
    errors.push(...cycleErrors(accepted));
}

function shapeOf(library: ComponentLibrary, component: string): Shape | undefined {
    if (!Object.hasOwn(library, component)) return undefined;
    const entry = library[component];
    return entry?.tier === 'root' ? entry.shape : undefined;
}

function walk(root: Node, rootPath: string, library: ComponentLibrary, visitNode: (node: Node, path: string) => void): void {
    const visit = (node: Node, path: string): void => {
        visitNode(node, path);
        for (const child of nodeChildren(node, path, shapeOf(library, node.component))) {
            visit(child.node as Node, child.path);
        }
    };
    visit(root, rootPath);
}

/**
 * Checks the `theme` object of every node of the resolved `app` tree and of each composed tree. A node may override
 * semantic and component tokens only: a path in `palette`, `scale` or `font` is `SUI-THEME-LAYER` (naming the
 * component and node), a path that is not a token `SUI-THEME-TOKEN`, a value of the wrong type or with injection
 * characters `SUI-THEME-VALUE`, and a reference to an unknown token, against the layer direction or in a cycle among
 * the node's own overrides `SUI-THEME-REF`. A value may reference tokens (`"{color.success.base}"`). The state path of
 * each error is the path of the leaf below the node's `theme`
 */
export function validateNodeThemes(context: DocumentValidationContext, components: readonly ComponentToken[]): BuildError[] {
    const errors: BuildError[] = [];
    const types = typeTable(components);
    const check = (node: Node, path: string): void => checkTheme(node, path, types, errors);
    walk(context.tree.node, APP_PATH, context.library, check);
    for (const [name, tree] of Object.entries(context.screens ?? {})) walk(tree.node, `$.screens.${name}`, context.library, check);
    const composed = context.document.composed;
    if (composed === undefined || !isObject(composed as JsonValue)) return errors;
    for (const [name, tree] of Object.entries(composed)) {
        if (!isObject(tree) || typeof tree.component !== 'string') continue;
        const path = `$.composed.${name}`;
        const own: JsonObject = { ...tree };
        delete own.exposes;
        const result = resolveNode(own as Node, context.library, composed, { path });
        walk(result.node, path, context.library, check);
    }
    return errors;
}
