import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildError } from '../../core/errors/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { Shape } from '../../core/shape/index.js';
import type { AppInstance } from '../../core/snapshot/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from './index.js';
import type { MountedApp, MountOptions } from './index.js';

function shapeOf(properties: Record<string, unknown>, events: string[] = []): Shape {
    const result = parseShape({ summary: 'Fixture', properties, events }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

const library: ComponentLibrary = Object.freeze({
    panel: { tier: 'root', tag: 'x-ins-panel', shape: shapeOf({ children: { type: 'map', items: 'string', default: {} } }) },
    field: { tier: 'root', tag: 'x-ins-field', shape: shapeOf({ value: { type: 'string', default: '' } }) },
    button: { tier: 'root', tag: 'x-ins-button', shape: shapeOf({}, ['press']) },
    outlet: { tier: 'root', tag: 'x-ins-outlet', shape: shapeOf({}) }
});

defineComponent({
    tag: 'x-ins-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
/** Shows its typed value, so a test can read it from the DOM */
defineComponent({ tag: 'x-ins-field', template: '<output>{{ $.value }}</output>' });
defineComponent({ tag: 'x-ins-button', template: '<b>button</b>' });
defineComponent({ tag: 'x-ins-outlet', template: '<section><slot></slot></section>' });

/** A shell with a search field and an outlet, a home screen with a button to the product screen, a night overlay */
const DOCUMENT = {
    app: { component: 'panel', children: { search: { component: 'field' }, main: { component: 'outlet' } } },
    screens: {
        home: {
            root: {
                component: 'panel',
                children: { open: { component: 'button', on: { press: { command: 'navigate', target: 'product', value: { id: 'p2' } } } } }
            }
        },
        product: { params: { id: { type: 'string', required: true } }, root: { component: 'panel', children: { qty: { component: 'field' } } } }
    },
    start: 'home',
    themes: { night: { kind: 'mode', tokens: { color: { surface: { base: '#101820' } } } } },
    appThemes: {
        plain: { tokens: {}, overlays: { night: { kind: 'mode', tokens: { color: { surface: { base: '#101820' } } } } } },
        bold: { tokens: { color: { accent: { base: '#0030ff' } } }, overlays: { night: { kind: 'mode', tokens: { color: { surface: { base: '#000020' } } } } } }
    },
    data: { bag: {} }
} as unknown as AppDocument;

/** The output text of every field below `root`, crossing shadow roots, in document order */
function fieldTexts(root: ParentNode, found: string[] = []): string[] {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === 'x-ins-field') found.push(candidate.shadowRoot?.querySelector('output')?.textContent ?? '');
        if (candidate.shadowRoot) fieldTexts(candidate.shadowRoot, found);
    }
    return found;
}

/** The night overlay darkens the surface, so the document has contrast warnings of its own; these tests leave them out */
function notContrast(errors: readonly BuildError[]): BuildError[] {
    return errors.filter((error) => error.code !== 'SUI-THEME-CONTRAST');
}

function find(root: ParentNode, tag: string): Element | undefined {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate;
        const inner = candidate.shadowRoot ? find(candidate.shadowRoot, tag) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

describe('a persona instance in mountApp', () => {
    const apps: MountedApp[] = [];
    let errorSpy: ReturnType<typeof vi.spyOn>;

    function start(doc: AppDocument, options: MountOptions): { app: MountedApp; host: HTMLElement } {
        const host = document.body.appendChild(document.createElement('div'));
        const app = mountApp(host, doc, library, {}, { route: false, ...options });
        apps.push(app);
        return { app, host };
    }

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        for (const app of apps.splice(0)) app.dispose();
        errorSpy.mockRestore();
        document.body.replaceChildren();
    });

    it('should show a typed value of the instance after mount and start on its screen, theme and data', () => {
        // Arrange
        const instance: AppInstance = {
            app: { children: { search: { value: 'lamp' } } },
            screens: { product: { children: { qty: { value: '3' } } } },
            route: { screen: 'product', params: { id: 'p2' } },
            theme: { active: { mode: 'night' } },
            data: { bag: { l1: { qty: 3 } } }
        };

        // Act
        const { app, host } = start(JSON.parse(JSON.stringify(DOCUMENT)) as AppDocument, { instance });

        // Assert
        expect(notContrast(app.errors)).toEqual([]);
        expect(fieldTexts(host)).toEqual(['lamp', '3']);
        expect(app.visibleScreen()).toBe('product');
        expect(app.store?.get('$.theme.active.mode')).toBe('night');
        expect(app.store?.get('$.theme.tokens.color.surface.base')).toBe('#101820');
        expect(app.store?.get('$.data.bag.l1.qty')).toBe(3);
    });

    it('should mount a stale screen and overlay name with warnings, not errors', () => {
        // Act
        const { app } = start(JSON.parse(JSON.stringify(DOCUMENT)) as AppDocument, {
            instance: { app: {}, screens: {}, route: { screen: 'cart', params: {} }, theme: { active: { mode: 'dusk' } } }
        });

        // Assert
        expect(app.store).toBeDefined();
        expect(notContrast(app.errors).map((error) => `${error.code} ${error.severity} ${error.statePath}`)).toEqual([
            'SUI-INSTANCE-STALE warning $.route',
            'SUI-INSTANCE-STALE warning $.theme.active.mode'
        ]);
        expect(app.visibleScreen()).toBe('home');
        expect(app.store?.get('$.theme.active.mode')).toBe('light');
    });

    it('should never write the definition: a deep-frozen document mounts, takes interaction and a theme switch, and disposes', () => {
        // Arrange
        const frozen = deepFreeze(JSON.parse(JSON.stringify(DOCUMENT)) as AppDocument);
        const instance = deepFreeze({ app: { children: { search: { value: 'lamp' } } }, screens: {}, data: { bag: { l1: { qty: 1 } } } } as AppInstance);

        // Act
        const run = (): void => {
            const { app, host } = start(frozen, { instance });
            app.store?.set('$.app.children.search.value' as never, 'chair' as never);
            app.store?.set('$.data.bag.l2' as never, { qty: 2 } as never);
            app.store?.set('$.theme.active.mode' as never, 'night' as never);
            app.store?.set('$.theme.active.theme' as never, 'bold' as never);
            (find(host, 'x-ins-button') as Element).dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));
            app.store?.set('$.screens.product.children.qty.value' as never, '5' as never);
            app.navigate('home');
            app.dispose();
        };

        // Assert
        expect(run).not.toThrow();
        expect(frozen).toEqual(DOCUMENT);
        expect(errorSpy).not.toHaveBeenCalled();
    });
});
