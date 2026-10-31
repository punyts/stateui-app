import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import type { JsonObject, JsonValue } from '../types.js';
import { DEFAULT_LEAVES, DEFAULT_TOKENS, componentTypeMap, flattenTokens } from './defaults.js';
import { validateTokenNames } from './names.js';
import { validateReferences } from './references.js';
import { TOKENS_STATE_PATH } from './types.js';
import type { ComponentToken, TokenLeaf, TokenTree, TokenType } from './types.js';
import { validateTokenValue } from './value.js';

export interface ValidateTokensOptions {
    /** The component tokens the library declares; their paths and types join the known set */
    componentTokens?: readonly ComponentToken[];
}

interface Entry {
    path: string;
    value: JsonValue;
}

function entriesOf(tree: JsonObject, prefix: readonly string[] = []): Entry[] {
    const entries: Entry[] = [];
    for (const [key, value] of Object.entries(tree)) {
        const path = [...prefix, key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) entries.push(...entriesOf(value, path));
        else entries.push({ path: path.join('.'), value });
    }
    return entries;
}

function statePath(path: string): string {
    return `${TOKENS_STATE_PATH}.${path}`;
}

/** Returns the leaves of the tree merged over the default tree and the component token defaults */
function effectiveLeaves(entries: readonly Entry[], components: readonly ComponentToken[]): TokenLeaf[] {
    const types = componentTypeMap(components);
    const merged = new Map<string, TokenLeaf>();
    for (const leaf of DEFAULT_LEAVES) merged.set(leaf.path, leaf);
    for (const token of components) {
        const [flat] = flattenTokens(nest(token.path, token.default), types);
        if (flat) merged.set(token.path, flat);
    }
    for (const entry of entries) {
        if (typeof entry.value !== 'string') continue;
        const known = merged.get(entry.path);
        if (known) merged.set(entry.path, { ...known, value: entry.value });
    }
    return [...merged.values()];
}

function nest(path: string, value: string): TokenTree {
    const segments = path.split('.');
    const tree: TokenTree = {};
    let cursor = tree;
    segments.forEach((segment, index) => {
        if (index === segments.length - 1) cursor[segment] = value;
        else {
            const next: TokenTree = {};
            cursor[segment] = next;
            cursor = next;
        }
    });
    return tree;
}

/**
 * Validates a whole or sparse token tree against the default tree's types and the component tokens.
 * Names (`SUI-THEME-NAME`), unknown paths (`SUI-THEME-TOKEN`), values of the wrong type or with injection
 * characters (`SUI-THEME-VALUE`) and references (`SUI-THEME-REF`, checked against the tree merged over the defaults)
 */
export function validateTokens(tree: JsonObject, options: ValidateTokensOptions = {}): BuildError[] {
    const nameErrors = validateTokenNames(tree);
    if (nameErrors.length > 0) return nameErrors;

    const components = options.componentTokens ?? [];
    const types = new Map<string, TokenType | undefined>();
    for (const leaf of DEFAULT_LEAVES) types.set(leaf.path, leaf.type);
    for (const token of components) types.set(token.path, token.type);
    const typeOf = (path: string): TokenType | undefined => types.get(path);

    const errors: BuildError[] = [];
    const entries = entriesOf(tree);
    for (const entry of entries) {
        if (!types.has(entry.path)) {
            errors.push(buildError('SUI-THEME-TOKEN', { path: entry.path, statePath: statePath(entry.path) }));
            continue;
        }
        const type = typeOf(entry.path) as TokenType;
        if (typeof entry.value !== 'string' || !validateTokenValue(type, entry.value, typeOf)) {
            errors.push(
                buildError('SUI-THEME-VALUE', { path: entry.path, statePath: statePath(entry.path), name: type })
            );
        }
    }
    if (errors.length > 0) return errors;

    return validateReferences(effectiveLeaves(entries, components));
}

/** The default tree merged with a sparse tree; used by callers that need the effective values */
export function mergeOverDefaults(tree: JsonObject): TokenTree {
    const result = structuredClone(DEFAULT_TOKENS);
    const apply = (target: TokenTree, source: JsonObject): void => {
        for (const [key, value] of Object.entries(source)) {
            if (typeof value === 'string') target[key] = value;
            else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                const existing = target[key];
                const next: TokenTree = typeof existing === 'object' ? existing : {};
                target[key] = next;
                apply(next, value);
            }
        }
    };
    apply(result, tree);
    return result;
}
