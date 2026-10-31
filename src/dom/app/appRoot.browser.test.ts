import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import { DEFAULT_LEAVES, DEFAULT_TOKENS } from '../../core/theme/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from '../mount/index.js';
import type { MountedApp } from '../mount/index.js';

const shape = parseShape({ summary: 'Fixture', properties: {}, events: [] }, 'fixture.state.json').shape;
if (!shape) throw new Error('fixture shape');

defineComponent({
    tag: 'x-root-one',
    template: '<x-root-two></x-root-two>',
    styles: ':host { display: block; }'
});
defineComponent({
    tag: 'x-root-two',
    template: '<x-root-three></x-root-three>',
    styles: ':host { display: block; }'
});
defineComponent({
    tag: 'x-root-three',
    template: '<i>deep</i>',
    styles: ':host { display: block; color: var(--ui-color-accent-base); background: var(--ui-palette-blue-600); }'
});

const library: ComponentLibrary = { deep: { tier: 'root', tag: 'x-root-one', shape } };
const documentOf = (theme?: AppDocument['theme']): AppDocument => ({ ...(theme ? { theme } : {}), app: { component: 'deep' } });

function deepest(host: ParentNode): Element | undefined {
    for (const candidate of Array.from(host.querySelectorAll('*'))) {
        if (candidate.localName === 'x-root-three') return candidate;
        const inner = candidate.shadowRoot ? deepest(candidate.shadowRoot) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

function root(host: Element): HTMLElement {
    const element = host.querySelector('ui-app-root');
    if (!(element instanceof HTMLElement)) throw new Error('no ui-app-root');
    return element;
}

/** A colour as the browser computes it */
function computed(value: string): string {
    const probe = window.document.body.appendChild(window.document.createElement('span'));
    probe.style.color = value;
    const result = getComputedStyle(probe).color;
    probe.remove();
    return result;
}

describe('<ui-app-root> token emission in Chromium', () => {
    const apps: MountedApp[] = [];
    let host: HTMLElement;

    function start(doc: AppDocument): MountedApp {
        const app = mountApp(host, doc, library);
        apps.push(app);
        return app;
    }

    beforeEach(() => {
        vi.spyOn(report, 'error').mockImplementation(() => undefined);
        host = window.document.body.appendChild(window.document.createElement('div'));
    });

    afterEach(() => {
        for (const app of apps.splice(0)) app.dispose();
        vi.restoreAllMocks();
        window.document.body.replaceChildren();
    });

    it('should write the default tree and the default active names into the store', () => {
        // Arrange / Act
        const app = start(documentOf());

        // Assert
        expect(app.errors).toEqual([]);
        expect(app.store?.get('$.theme.tokens')).toEqual(DEFAULT_TOKENS);
        expect(app.store?.get('$.theme.active')).toEqual({ mode: 'light', brand: 'default', motion: 'full' });
    });

    it('should take the active names from the document over the defaults', () => {
        // Arrange / Act
        const app = start(documentOf({ active: { mode: 'dark' } }));

        // Assert
        expect(app.store?.get('$.theme.active')).toEqual({ mode: 'dark', brand: 'default', motion: 'full' });
    });

    it('should render ui-app-root around the application and emit every token as a custom property', () => {
        // Arrange / Act
        start(documentOf());
        const element = root(host);
        const emitted = Array.from(element.style).filter((name) => name.startsWith('--sui-'));

        // Assert
        expect(emitted).toHaveLength(DEFAULT_LEAVES.length);
        expect(deepest(host)).toBeDefined();
        expect(getComputedStyle(element).getPropertyValue('--ui-scale-space-3').trim()).toBe('8px');
    });

    it('should mount a document that overrides one semantic token with that value', () => {
        // Arrange / Act
        const app = start(documentOf({ tokens: { color: { accent: { base: '#ff0000' } } } }));
        const target = deepest(host) as Element;

        // Assert
        expect(app.store?.get('$.theme.tokens.color.accent.base')).toBe('#ff0000');
        expect(getComputedStyle(target).color).toBe(computed('#ff0000'));
    });

    it('should change a custom property that a component three shadow roots deep reads', () => {
        // Arrange
        const app = start(documentOf());
        const target = deepest(host) as Element;
        const before = getComputedStyle(target).color;

        // Act
        app.store?.set('$.theme.tokens.color.accent.base', '#00ff00');

        // Assert
        expect(before).not.toBe(computed('#00ff00'));
        expect(getComputedStyle(target).color).toBe(computed('#00ff00'));
    });

    it('should keep references live: one custom property write moves every role that references the primitive', () => {
        // Arrange
        const app = start(documentOf({ tokens: { color: { accent: { base: '{palette.blue.600}' } } } }));
        const target = deepest(host) as Element;
        const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');

        // Act
        app.store?.set('$.theme.tokens.palette.blue.600', '#123456');

        // Assert
        expect(setProperty).toHaveBeenCalledTimes(1);
        expect(getComputedStyle(target).color).toBe(computed('#123456'));
        expect(getComputedStyle(target).backgroundColor).toBe(computed('#123456'));
    });

    it('should patch exactly one custom property per token write, synchronously, and never read layout', () => {
        // Arrange
        const app = start(documentOf());
        const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
        const computedStyle = vi.spyOn(window, 'getComputedStyle');
        const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
        const offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get');

        // Act
        app.store?.set('$.theme.tokens.color.text.muted', '#445566');

        // Assert
        expect(setProperty).toHaveBeenCalledTimes(1);
        expect(setProperty.mock.calls[0]?.[1]).toBe('#445566');
        expect(computedStyle).not.toHaveBeenCalled();
        expect(rect).not.toHaveBeenCalled();
        expect(offsetWidth).not.toHaveBeenCalled();
    });

    it('should stop with SUI-THEME errors before render for an invalid document token', () => {
        // Arrange / Act
        const app = start(documentOf({ tokens: { color: { accent: { base: 'url(https://x)' } } } }));

        // Assert
        expect(app.store).toBeUndefined();
        expect(app.errors.map((error) => [error.code, error.statePath])).toContainEqual([
            'SUI-THEME-VALUE',
            '$.theme.tokens.color.accent.base'
        ]);
        expect(host.childNodes).toHaveLength(0);
    });
});
