import { defineComponent } from '@punyts/stateui';

export const APP_ROOT_TAG = 'ui-app-root';

/**
 * Defines `<ui-app-root>`, which holds `<sui-node state="$.app">`, unless the library already registered one (the
 * generated root of E3.4 carries the theme custom properties and takes this one's place)
 */
export function ensureAppRoot(): void {
    if (customElements.get(APP_ROOT_TAG)) return;
    defineComponent({
        tag: APP_ROOT_TAG,
        template: '<sui-node state="$.app"></sui-node>',
        styles: ':host { display: contents; }'
    });
}
