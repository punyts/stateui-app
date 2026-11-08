import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentOverlays } from '../../core/locale/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { Shape } from '../../core/shape/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from '../mount/index.js';
import type { MountedApp } from '../mount/index.js';
import { SCREEN_ATTRIBUTE } from '../mount/screens.js';
import { registerLocaleStep, switchLocale } from './index.js';
import type { LocaleStepHandle } from './index.js';

function shapeOf(properties: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Fixture', properties }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const content = { type: 'string', kind: 'content', default: '' };

const library: ComponentLibrary = Object.freeze({
    panel: { tier: 'root', tag: 'x-sloc-panel', shape: shapeOf({ children: { type: 'map', items: 'string', default: {} } }) },
    heading: { tier: 'root', tag: 'x-sloc-heading', shape: shapeOf({ _text: { ...content, default: 'Heading' } }) },
    app: { tier: 'root', tag: 'x-sloc-app', shape: shapeOf({ toasts: { type: 'node' } }) }
});

defineComponent({
    tag: 'x-sloc-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-sloc-heading', template: '<h1>{{ $._text }}</h1>' });
defineComponent({ tag: 'x-sloc-app', template: '<section layout-host=""></section><sui-node state=".toasts"></sui-node>' });

/** The heading component's own default is translated by its overlay; text the author wrote comes from `locales` */
const components: ComponentOverlays = Object.freeze({ heading: Object.freeze({ de: Object.freeze({ _text: 'Überschrift' }) }) });

/** An app node whose toasts stand-in has text, a home screen with the component default and a product screen with its own text */
const DOCUMENT = Object.freeze({
    locale: 'en',
    app: { component: 'app', toasts: { component: 'heading', _text: 'Shop' } },
    locales: { de: { toasts: { _text: 'Laden' } } },
    screens: {
        home: { root: { component: 'panel', children: { title: { component: 'heading' } } } },
        product: {
            root: { component: 'panel', children: { name: { component: 'heading', _text: 'A product' } } },
            locales: { de: { children: { name: { _text: 'Ein Produkt' } } } }
        }
    },
    start: 'home'
});

function copy(): AppDocument {
    return JSON.parse(JSON.stringify(DOCUMENT)) as AppDocument;
}

/** The text of each screen container below `root`, crossing shadow roots */
function screenTexts(root: ParentNode, found: Record<string, string> = {}): Record<string, string> {
    for (const element of Array.from(root.querySelectorAll('*'))) {
        const name = element.getAttribute(SCREEN_ATTRIBUTE);
        if (name !== null) found[name] = textOf(element);
        if (element.shadowRoot) screenTexts(element.shadowRoot, found);
    }
    return found;
}

function textOf(root: ParentNode): string {
    let text = '';
    for (const child of Array.from(root.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
        else if (child instanceof Element) {
            text += child.shadowRoot ? textOf(child.shadowRoot) : '';
            text += textOf(child);
        }
    }
    return text.trim();
}

describe('locales of screens', () => {
    const apps: MountedApp[] = [];
    const handles: LocaleStepHandle[] = [];
    let errorSpy: ReturnType<typeof vi.spyOn>;

    function start(): { app: MountedApp; host: HTMLElement; handle: LocaleStepHandle } {
        const handle = registerLocaleStep(components);
        handles.push(handle);
        const host = document.body.appendChild(document.createElement('div'));
        const app = mountApp(host, copy(), library);
        apps.push(app);
        return { app, host, handle };
    }

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        for (const app of apps.splice(0)) app.dispose();
        for (const handle of handles.splice(0)) handle.unregister();
        errorSpy.mockRestore();
        document.body.replaceChildren();
    });

    it('should translate the shown screen, then a screen mounted after the switch, and keep the hidden one translated', () => {
        // Arrange
        const { app, host, handle } = start();

        // Act
        const switched = handle.switchTo('de');
        const before = screenTexts(host);
        app.navigate('product');
        const after = screenTexts(host);

        // Assert
        expect(app.errors).toEqual([]);
        expect(switched).toEqual([]);
        expect(before).toEqual({ home: 'Überschrift' });
        expect(after).toEqual({ home: 'Überschrift', product: 'Ein Produkt' });
        expect(app.store?.get('$.app.toasts._text')).toBe('Laden');
        expect(app.store?.get('$.locale')).toBe('de');
    });

    it('should restore every screen and the app node when switching back to the base language', () => {
        // Arrange
        const { app, host, handle } = start();
        app.navigate('product');
        handle.switchTo('de');

        // Act
        const errors = handle.switchTo('en');

        // Assert
        expect(errors).toEqual([]);
        expect(screenTexts(host)).toEqual({ home: 'Heading', product: 'A product' });
        expect(app.store?.get('$.app.toasts._text')).toBe('Shop');
        expect(handle.screenOverlays?.['product']?.['en']).toEqual({ children: { name: { _text: 'A product' } } });
    });

    it('should translate a node written later below a screen for the current language and keep it in later switches', () => {
        // Arrange
        const { app, host, handle } = start();
        handle.switchTo('de');

        // Act
        app.store?.set('$.screens.home.children.more' as never, { component: 'heading', _text: 'Heading' } as never);
        const german = screenTexts(host)['home'];
        handle.switchTo('en');
        const english = screenTexts(host)['home'];

        // Assert
        expect(german).toBe('ÜberschriftÜberschrift');
        expect(english).toBe('HeadingHeading');
        expect(handle.screenOverlays?.['home']?.['de']).toEqual({ children: { title: { _text: 'Überschrift' }, more: { _text: 'Überschrift' } } });
    });

    it('should switch screens with switchLocale and the mounted base overlays, without the locale step', () => {
        // Arrange
        const host = document.body.appendChild(document.createElement('div'));
        const app = mountApp(host, copy(), library);
        apps.push(app);
        const store = app.store as never;
        const screens = {
            product: { en: app.screenBaseOverlays?.['product'] ?? {}, de: { children: { name: { _text: 'Ein Produkt' } } } }
        };

        // Act
        const german = switchLocale(store, 'de', {}, screens);
        const product = app.store?.get('$.screens.product.children.name._text');
        const back = switchLocale(store, 'en', {}, screens);
        const unknown = switchLocale(store, 'fr', {}, screens);

        // Assert
        expect(app.screenBaseOverlays).toEqual({
            home: { children: { title: { _text: 'Heading' } } },
            product: { children: { name: { _text: 'A product' } } }
        });
        expect(german).toEqual([]);
        expect(product).toBe('Ein Produkt');
        expect(back).toEqual([]);
        expect(app.store?.get('$.screens.product.children.name._text')).toBe('A product');
        expect(unknown.map((error) => error.code)).toEqual(['SUI-LOCALE-UNKNOWN']);
        expect(app.store?.get('$.locale')).toBe('en');
    });
});
