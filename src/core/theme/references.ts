import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { TOKENS_STATE_PATH } from './types.js';
import type { TokenLeaf } from './types.js';

/** A piece of a token value: literal text or a `{path}` reference */
export type ValuePart = { kind: 'text'; text: string } | { kind: 'ref'; path: string };

const REFERENCE = /\{([a-z0-9]+(?:\.[a-z0-9]+)*)\}/g;

/**
 * Splits a token value into literal and `{path}` parts. A reference may sit inside a larger value.
 * Braces that do not hold a well-formed path stay literal text, so the value check can reject them
 */
export function parseValue(text: string): ValuePart[] {
    const parts: ValuePart[] = [];
    let last = 0;
    for (const match of text.matchAll(REFERENCE)) {
        const index = match.index ?? 0;
        if (index > last) parts.push({ kind: 'text', text: text.slice(last, index) });
        parts.push({ kind: 'ref', path: match[1] as string });
        last = index + match[0].length;
    }
    if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
    return parts;
}

/** The paths a value references, in order */
export function referencesOf(text: string): string[] {
    const paths: string[] = [];
    for (const part of parseValue(text)) if (part.kind === 'ref') paths.push(part.path);
    return paths;
}

/** Replaces each reference with a live `var(--ui-<path joined by ->)`; the browser resolves the chain */
export function toCssValue(text: string): string {
    return parseValue(text)
        .map((part) => (part.kind === 'text' ? part.text : `var(--ui-${part.path.split('.').join('-')})`))
        .join('');
}

function refError(leaf: TokenLeaf, target: string, reason: string): BuildError {
    return buildError('SUI-THEME-REF', {
        path: leaf.path,
        statePath: `${TOKENS_STATE_PATH}.${leaf.path}`,
        target,
        name: reason
    });
}

/**
 * Checks references among leaves: an unknown reference (a group is not a token), a reference against the layer
 * direction (primitives reference nothing, semantic tokens reference primitives or semantic tokens, component tokens
 * reference semantic tokens) and a cycle among semantic tokens. Each is a `SUI-THEME-REF` with the state path;
 * a cycle names its chain. References are never resolved here beyond what validation needs
 */
export function validateReferences(leaves: readonly TokenLeaf[]): BuildError[] {
    const errors: BuildError[] = [];
    const byPath = new Map(leaves.map((leaf) => [leaf.path, leaf]));
    const edges = new Map<string, string[]>();

    for (const leaf of leaves) {
        const semanticTargets: string[] = [];
        for (const target of referencesOf(leaf.value)) {
            const found = byPath.get(target);
            if (found === undefined) {
                errors.push(refError(leaf, target, 'no such token'));
            } else if (leaf.layer === 'primitive') {
                errors.push(refError(leaf, target, 'a primitive references nothing'));
            } else if (leaf.layer === 'semantic' && found.layer === 'component') {
                errors.push(refError(leaf, target, 'a semantic token cannot reference a component token'));
            } else if (leaf.layer === 'component' && found.layer !== 'semantic') {
                errors.push(refError(leaf, target, 'a component token may only reference semantic tokens'));
            } else if (leaf.layer === 'semantic' && found.layer === 'semantic') {
                semanticTargets.push(target);
            }
        }
        if (leaf.layer === 'semantic') edges.set(leaf.path, semanticTargets);
    }

    const state = new Map<string, 'open' | 'done'>();
    const stack: string[] = [];
    const visit = (path: string): void => {
        state.set(path, 'open');
        stack.push(path);
        for (const next of edges.get(path) ?? []) {
            const seen = state.get(next);
            if (seen === 'open') {
                const chain = [...stack.slice(stack.indexOf(next)), next];
                const first = byPath.get(chain[0] as string) as TokenLeaf;
                errors.push(refError(first, chain.join(' -> '), 'cycle'));
            } else if (seen === undefined) {
                visit(next);
            }
        }
        stack.pop();
        state.set(path, 'done');
    };
    for (const path of edges.keys()) if (!state.has(path)) visit(path);

    return errors;
}
