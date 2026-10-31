import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import type { ComponentToken } from '../theme/types.js';
import type { Shape } from './types.js';

/** A parsed shape with the file it came from, so a conflict can name the file */
export interface ShapeSource {
    file: string;
    shape: Pick<Shape, 'tokens'>;
}

/** The token set of a library and the conflicts found while collecting it */
export interface CollectedTokens {
    /** Every declared token once, sorted by path */
    tokens: ComponentToken[];
    /** One `SUI-BUILD-TOKENCONFLICT` per file whose entries for a shared group differ from the first file's */
    errors: BuildError[];
}

function signature(tokens: readonly ComponentToken[]): string {
    return tokens
        .map((token) => `${token.path}=${token.default}`)
        .sort()
        .join('\n');
}

/**
 * Returns the component token set of a library: `{ path, group, type, default }` for every token its shapes declare.
 * Shapes may share a group (the field family, the bare controls) only when they declare identical entries for it;
 * a shape whose entries differ from the first declaration of the group gets a `SUI-BUILD-TOKENCONFLICT` naming
 * its file and the first file, and its entries are left out
 */
export function collectComponentTokens(sources: Iterable<ShapeSource>): CollectedTokens {
    const first = new Map<string, { file: string; tokens: ComponentToken[] }>();
    const errors: BuildError[] = [];
    for (const { file, shape } of sources) {
        const byGroup = new Map<string, ComponentToken[]>();
        for (const token of shape.tokens ?? []) byGroup.set(token.group, [...(byGroup.get(token.group) ?? []), token]);
        for (const [group, tokens] of byGroup) {
            const earlier = first.get(group);
            if (earlier === undefined) first.set(group, { file, tokens });
            else if (signature(earlier.tokens) !== signature(tokens)) {
                errors.push(buildError('SUI-BUILD-TOKENCONFLICT', { file, name: group, other: earlier.file }));
                errors.push(buildError('SUI-BUILD-TOKENCONFLICT', { file: earlier.file, name: group, other: file }));
            }
        }
    }
    const all = [...first.values()].flatMap((entry) => entry.tokens);
    all.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { tokens: all, errors };
}
