import tokens from './tokens.default.json' with { type: 'json' };
import { cssName } from './names.js';
import type { ComponentToken, TokenLayer, TokenLeaf, TokenTree, TokenType } from './types.js';

/** The default token tree for the `light` mode and `default` brand; callers clone it before writing */
export const DEFAULT_TOKENS: TokenTree = tokens;

const PRIMITIVE_GROUPS: readonly string[] = ['palette', 'scale', 'font'];
const SEMANTIC_GROUPS: readonly string[] = [
    'color',
    'space',
    'size',
    'icon',
    'radius',
    'border',
    'elevation',
    'text',
    'motion',
    'density',
    'focus'
];

/** The layer of a token, from the first path segment; a group the default tree does not have is a component group */
export function tokenLayer(path: string | readonly string[]): TokenLayer {
    const group = typeof path === 'string' ? path.split('.')[0] : path[0];
    if (group !== undefined && PRIMITIVE_GROUPS.includes(group)) return 'primitive';
    if (group !== undefined && SEMANTIC_GROUPS.includes(group)) return 'semantic';
    return 'component';
}

const TEXT_TYPES: Record<string, TokenType> = {
    family: 'fontFamily',
    size: 'dimension',
    weight: 'fontWeight',
    leading: 'number'
};

/** The type of a default-tree token, taken from its path; `undefined` for a path outside the default groups */
export function tokenTypeOf(path: string | readonly string[]): TokenType | undefined {
    const [group, second, third] = typeof path === 'string' ? path.split('.') : path;
    switch (group) {
        case 'palette':
        case 'color':
            return 'color';
        case 'scale':
        case 'space':
        case 'size':
        case 'radius':
        case 'border':
        case 'focus':
            return 'dimension';
        case 'font':
            return second === undefined ? undefined : second === 'size' ? 'dimension' : TEXT_TYPES[second];
        case 'text':
            return third === undefined ? undefined : TEXT_TYPES[third];
        case 'icon':
        case 'density':
            return 'number';
        case 'elevation':
            return third === 'shadow' ? 'shadow' : third === 'layer' ? 'number' : undefined;
        case 'motion':
            return second === 'duration' ? 'duration' : second === 'easing' ? 'easing' : undefined;
        default:
            return undefined;
    }
}

function walk(tree: TokenTree, prefix: readonly string[], visit: (segments: readonly string[], value: string) => void): void {
    for (const [key, value] of Object.entries(tree)) {
        const segments = [...prefix, key];
        if (typeof value === 'string') visit(segments, value);
        else walk(value, segments, visit);
    }
}

/**
 * Returns every leaf of a token tree as `{ path, cssName, layer, type, value }`, in tree order.
 * `componentTypes` maps a component token path to its type; without an entry such a leaf has no `type`.
 * A key that is not lower-case letters and digits throws a `TokenNameError`
 */
export function flattenTokens(tree: TokenTree, componentTypes?: ReadonlyMap<string, TokenType>): TokenLeaf[] {
    const leaves: TokenLeaf[] = [];
    walk(tree, [], (segments, value) => {
        const path = segments.join('.');
        const layer = tokenLayer(segments);
        const type = layer === 'component' ? componentTypes?.get(path) : tokenTypeOf(segments);
        const leaf: TokenLeaf = { path, cssName: cssName(segments), layer, value };
        if (type !== undefined) leaf.type = type;
        leaves.push(leaf);
    });
    return leaves;
}

/** The type lookup for a list of component tokens */
export function componentTypeMap(tokens: readonly ComponentToken[]): Map<string, TokenType> {
    return new Map(tokens.map((token) => [token.path, token.type]));
}

/** Every leaf of the default tree */
export const DEFAULT_LEAVES: readonly TokenLeaf[] = flattenTokens(DEFAULT_TOKENS);
