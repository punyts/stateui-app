import type { NodeThemeMapper } from '@punyts/stateui';
import { DEFAULT_LEAVES, cssName, hasInjection, tokenLayer, toCssValue } from '../../core/theme/index.js';
import type { ComponentToken } from '../../core/theme/index.js';

/**
 * The theme mapper `<sui-node>` uses for a node's `theme` override (E3.14): a path below `theme` becomes its `--ui-`
 * custom property name and a value goes through `toCssValue`, so a reference stays a live `var()`. The document
 * validator rejects bad overrides before render; the mapper also refuses at run time what a state write could add
 * later: a path that is not a semantic or component token (a primitive included) is skipped, and a value with
 * injection characters is written empty, which removes the property
 */
export function nodeThemeMapper(componentTokens: readonly ComponentToken[] = []): NodeThemeMapper {
    const known = new Set<string>([...DEFAULT_LEAVES.map((leaf) => leaf.path), ...componentTokens.map((token) => token.path)]);
    return {
        property(path: string[]): string | undefined {
            const joined = path.join('.');
            if (!known.has(joined) || tokenLayer(joined) === 'primitive') return undefined;
            return cssName(path);
        },
        value(text: string): string {
            return hasInjection(text) ? '' : toCssValue(text);
        }
    };
}
