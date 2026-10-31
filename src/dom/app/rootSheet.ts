import { DEFAULT_LEAVES, TOKENS_STATE_PATH, cssName } from '../../core/theme/index.js';
import type { ComponentToken, TokenLeaf } from '../../core/theme/index.js';

/** The name of the controller member the style bindings call to turn a token value into its `var()` form */
export const CSS_VALUE = 'cssValue';

/** The leaves a library's component tokens add to the host: no value, because the default is a CSS fallback */
export function componentLeaves(tokens: readonly ComponentToken[]): TokenLeaf[] {
    return tokens.map((token) => ({
        path: token.path,
        cssName: cssName(token.path),
        layer: 'component',
        type: token.type,
        value: token.default
    }));
}

/**
 * The static styles of `<ui-app-root>`: one custom property per token leaf, each bound to its store path.
 * The property name must be static in a StateUI style binding, so the set of tokens is closed by this sheet
 */
export function tokenSheet(leaves: readonly TokenLeaf[] = DEFAULT_LEAVES): string {
    const declarations = leaves.map((leaf) => `    ${leaf.cssName}: {{ ${CSS_VALUE}(${TOKENS_STATE_PATH}.${leaf.path}) }};`);
    return [':host {', '    display: contents;', ...declarations, '}'].join('\n');
}
