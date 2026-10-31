import { DEFAULT_LEAVES } from './defaults.js';
import { referencesOf } from './references.js';
import type { TokenType } from './types.js';
import { hasInjection, validateTokenValue } from './value.js';

const DEFAULT_BY_PATH = new Map(DEFAULT_LEAVES.map((leaf) => [leaf.path, leaf]));
const lookup = (path: string): TokenType | undefined => DEFAULT_BY_PATH.get(path)?.type;

/** The outcome of checking a component token default: its inferred type, or the reason it is not allowed */
export type ComponentDefaultResult = { type: TokenType } | { reason: string };

/**
 * Checks the default a shape gives a component token and infers the token type from what it references.
 * A default must reference at least one semantic token (a literal is rejected, and so is a primitive, a component
 * token or an unknown path). One reference gives that token's type; a `calc()` of dimensions and numbers (with at
 * least one dimension) is a dimension. The value must also pass the value check of E3.3
 */
export function inferComponentDefault(value: string): ComponentDefaultResult {
    if (hasInjection(value)) return { reason: 'the default holds characters a token value may not hold' };
    const references = referencesOf(value);
    if (references.length === 0) return { reason: 'the default must reference a semantic token' };
    for (const path of references) {
        const leaf = DEFAULT_BY_PATH.get(path);
        if (leaf === undefined) return { reason: `no such token: ${path}` };
        if (leaf.layer !== 'semantic') return { reason: `only semantic tokens may be referenced: ${path}` };
    }
    const trimmed = value.trim();
    const types = references.map((path) => lookup(path) as TokenType);
    let type: TokenType;
    if (references.length === 1 && trimmed === `{${references[0] as string}}`) {
        type = types[0] as TokenType;
    } else if (
        trimmed.startsWith('calc(') &&
        types.every((entry) => entry === 'dimension' || entry === 'number') &&
        types.includes('dimension')
    ) {
        type = 'dimension';
    } else {
        return { reason: 'a reference inside a larger value must sit in a calc() of dimensions' };
    }
    if (!validateTokenValue(type, trimmed, lookup)) return { reason: 'the default is not a valid value' };
    return { type };
}
