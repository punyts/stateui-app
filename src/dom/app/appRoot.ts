import { defineComponent } from '@punyts/stateui';
import { DEFAULT_LEAVES, toCssValue } from '../../core/theme/index.js';
import type { ComponentToken } from '../../core/theme/index.js';
import { CSS_VALUE, componentLeaves, tokenSheet } from './rootSheet.js';

export const APP_ROOT_TAG = 'ui-app-root';

/** The tag defined for each set of component tokens, keyed by the sorted paths; custom elements cannot be redefined */
const defined = new Map<string, string>();

/**
 * Defines `<ui-app-root>`: the application host. Its styles declare every default token and every component token as a
 * custom property bound to `$.theme.tokens.<path>`, so a token write patches one property and everything below the
 * host reads it with `var()`. A component token that is not set binds an empty value, which StateUI removes, so the
 * fallback in the component's CSS applies. Its template holds `<sui-node state="$.app">`.
 *
 * A style sheet is fixed when a tag is defined, so each distinct set of component tokens gets its own tag: the first
 * set takes `ui-app-root`, a different set later takes `ui-app-root-2`, `ui-app-root-3` and so on. Returns the tag
 * for `tokens`; defining the same set again returns the tag it already has
 */
export function ensureAppRoot(tokens: readonly ComponentToken[] = []): string {
    const key = tokens
        .map((token) => token.path)
        .sort()
        .join(',');
    const known = defined.get(key);
    if (known !== undefined && customElements.get(known)) return known;
    if (defined.size === 0 && key === '' && customElements.get(APP_ROOT_TAG)) {
        defined.set(key, APP_ROOT_TAG);
        return APP_ROOT_TAG;
    }
    const tag = defined.size === 0 ? APP_ROOT_TAG : `${APP_ROOT_TAG}-${defined.size + 1}`;
    defineComponent({
        tag,
        template: '<sui-node state="$.app"></sui-node>',
        styles: tokenSheet([...DEFAULT_LEAVES, ...componentLeaves(tokens)]),
        controller: () => ({ [CSS_VALUE]: (value: unknown): string => toCssValue(String(value ?? '')) })
    });
    defined.set(key, tag);
    return tag;
}
