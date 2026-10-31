import { defineComponent } from '@punyts/stateui';
import { toCssValue } from '../../core/theme/index.js';
import { CSS_VALUE, tokenSheet } from './rootSheet.js';

export const APP_ROOT_TAG = 'ui-app-root';

/**
 * Defines `<ui-app-root>`: the application host. Its styles declare every token as a custom property bound to
 * `$.theme.tokens.<path>`, so a token write patches one property and everything below the host reads it with `var()`.
 * Its template holds `<sui-node state="$.app">`. Does nothing when the tag is already registered
 */
export function ensureAppRoot(): void {
    if (customElements.get(APP_ROOT_TAG)) return;
    defineComponent({
        tag: APP_ROOT_TAG,
        template: '<sui-node state="$.app"></sui-node>',
        styles: tokenSheet(),
        controller: () => ({ [CSS_VALUE]: (value: unknown): string => toCssValue(String(value ?? '')) })
    });
}
