import { toCssValue } from '../core/theme/index.js';
import { maskCss } from './lint/mask.js';
import { findUiVars } from './lint/vars.js';
import type { CssTransform } from './types.js';

/**
 * The transform the build always runs: it rewrites each bare `var(--ui-<group>-<token>)` of a declared component
 * token to `var(--ui-<group>-<token>, <default>)`, where the default is the shape's reference expression turned into
 * live `var()` references. The default stays a CSS fallback, so the application root never freezes it and a node
 * `theme` override of the semantic token still reaches the component. A `var()` that already has a fallback, a name
 * that is not a declared token, and anything in a comment or string are left alone
 */
export const applyTokenFallbacks: CssTransform = (css, context) => {
    const defaults = new Map(
        context.tokens.map((token) => [`--ui-${token.path.split('.').join('-')}`, toCssValue(token.default)])
    );
    if (defaults.size === 0) return css;
    const bare = findUiVars(maskCss(css)).filter((variable) => variable.fallback === undefined && defaults.has(variable.name));
    let result = css;
    for (const variable of bare.reverse()) {
        const fallback = defaults.get(variable.name) as string;
        result = `${result.slice(0, variable.end - 1)}, ${fallback}${result.slice(variable.end - 1)}`;
    }
    return result;
};
