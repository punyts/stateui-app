import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { Shape } from '../../core/shape/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from './index.js';
import type { MountedApp } from './index.js';
import { SCREEN_ATTRIBUTE, startScreens, writeRoute } from './screens.js';

function shapeOf(properties: Record<string, unknown>, events: string[] = []): Shape {
    const result = parseShape({ summary: 'Fixture', properties, events }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const library: ComponentLibrary = Object.freeze({
    panel: { tier: 'root', tag: 'x-scr-panel', shape: shapeOf({ children: { type: 'map', items: 'string', default: {} } }) },
    label: { tier: 'root', tag: 'x-scr-label', shape: shapeOf({ text: { type: 'string', default: '' } }) },
    field: { tier: 'root', tag: 'x-scr-field', shape: shapeOf({ value: { type: 'string', default: '' } }) },
    button: { tier: 'root', tag: 'x-scr-button', shape: shapeOf({}, ['press']) },
    /** The test stand-in for the real outlet (O1.7): it shows what is put in it */
    outlet: { tier: 'root', tag: 'x-scr-outlet', shape: shapeOf({}) }
});

defineComponent({
    tag: 'x-scr-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-scr-label', template: '<p>{{ $.text }}</p>' });
/** An input whose typed value lives only in the DOM, like any articulation the store does not hold */
defineComponent({ tag: 'x-scr-field', template: '<input />' });
defineComponent({ tag: 'x-scr-button', template: '<b>button</b>' });
defineComponent({ tag: 'x-scr-outlet', template: '<section><slot></slot></section>' });

/** A shell with a header and an outlet, a home screen with a field and a button that opens a product screen */
const DOCUMENT = Object.freeze({
    app: {
        component: 'panel',
        children: { header: { component: 'label', text: 'Shop' }, main: { component: 'outlet' } }
    },
    screens: {
        home: {
            title: 'Home',
            root: {
                component: 'panel',
                children: {
                    search: { component: 'field' },
                    open: { component: 'button', on: { press: { command: 'navigate', target: 'product', value: { id: 'p2' } } } },
                    greeting: { component: 'label', '<-text': '$.data.name' }
                }
            }
        },
        product: {
            title: 'Product',
            params: { id: { type: 'string', required: true } },
            root: { component: 'panel', children: { name: { component: 'label', text: 'A product' } } }
        }
    },
    start: 'home',
    data: { name: 'Ada' }
}) as unknown as AppDocument;

function copy(): AppDocument {
    return JSON.parse(JSON.stringify(DOCUMENT)) as AppDocument;
}

/** The first element with `tag` below `root`, crossing shadow roots */
function find(root: ParentNode, tag: string): Element | undefined {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate;
        const inner = candidate.shadowRoot ? find(candidate.shadowRoot, tag) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

/** Every element with `tag` below `root`, crossing shadow roots */
function findAll(root: ParentNode, tag: string, found: Element[] = []): Element[] {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) found.push(candidate);
        if (candidate.shadowRoot) findAll(candidate.shadowRoot, tag, found);
    }
    return found;
}

/** The screen names of the containers below `root` (crossing shadow roots) and whether each is hidden */
function containers(root: ParentNode): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const element of findAll(root, 'div')) {
        const name = element.getAttribute(SCREEN_ATTRIBUTE);
        if (name !== null) result[name] = (element as HTMLElement).hidden;
    }
    return result;
}

describe('screens in mountApp', () => {
    const apps: MountedApp[] = [];
    let errorSpy: ReturnType<typeof vi.spyOn>;

    function start(doc: AppDocument = copy()): { app: MountedApp; host: HTMLElement } {
        const host = document.body.appendChild(document.createElement('div'));
        const app = mountApp(host, doc, library);
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

    it('should hold the screens and the start route in the store, and mount only the start screen in the outlet', () => {
        // Act
        const { app, host } = start();

        // Assert
        expect(app.errors).toEqual([]);
        expect(app.store?.get('$.route')).toEqual({ screen: 'home', params: {} });
        expect(app.store?.get('$.screens.product.children.name.text')).toBe('A product');
        expect(app.store?.get('$.screens.home.children.greeting.text')).toBe('Ada');
        expect(app.visibleScreen()).toBe('home');
        expect(containers(host)).toEqual({ home: false });
        const outlet = find(host, 'x-scr-outlet') as Element;
        expect(outlet.querySelector(`[${SCREEN_ATTRIBUTE}="home"]`)).not.toBeNull();
        expect(find(outlet, 'x-scr-field')).toBeDefined();
    });

    it('should refuse a plain write to $.route and move it only through navigate', () => {
        // Arrange
        const { app } = start();

        // Act
        const written = app.store?.set('$.route.screen' as never, 'product' as never);
        const refused = app.navigate('product', {});
        const moved = app.navigate('product', { id: 'p7' });

        // Assert
        expect(written).toBe(false);
        expect(refused).toBe('param "id" of screen "product" is required');
        expect(moved).toBeUndefined();
        expect(app.store?.get('$.route')).toEqual({ screen: 'product', params: { id: 'p7' } });
        expect(app.visibleScreen()).toBe('product');
    });

    it('should navigate from an on entry of a screen node and hide the screen it left', () => {
        // Arrange
        const { app, host } = start();
        const button = find(host, 'x-scr-button') as Element;

        // Act
        button.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));

        // Assert
        expect(app.store?.get('$.route')).toEqual({ screen: 'product', params: { id: 'p2' } });
        expect(app.visibleScreen()).toBe('product');
        expect(containers(host)).toEqual({ home: true, product: false });
    });

    it('should keep what was typed on a screen across navigating away and back', () => {
        // Arrange
        const { app, host } = start();
        const input = (find(host, 'x-scr-field') as Element).shadowRoot?.querySelector('input') as HTMLInputElement;
        input.value = 'red shoes';

        // Act
        app.navigate('product', { id: 'p2' });
        app.navigate('home');

        // Assert
        const again = (find(host, 'x-scr-field') as Element).shadowRoot?.querySelector('input') as HTMLInputElement;
        expect(again).toBe(input);
        expect(again.value).toBe('red shoes');
        expect(containers(host)).toEqual({ home: false, product: true });
    });

    it('should keep the shell header as the same element across navigation', () => {
        // Arrange
        const { app, host } = start();
        const before = find(host, 'x-scr-label');

        // Act
        app.navigate('product', { id: 'p2' });

        // Assert
        expect(find(host, 'x-scr-label')).toBe(before);
        expect(before?.shadowRoot?.textContent).toContain('Shop');
    });

    it('should write and remove nodes below a screen root, and refuse paths outside the app and the screens', () => {
        // Arrange
        const { app, host } = start();

        // Act
        const written = app.writeNode('$.screens.home.children.note', { component: 'label', '<-text': '$.data.name' });
        const outside = app.writeNode('$.data.note', { component: 'label' });
        const unknown = app.writeNode('$.screens.cart.children.x', { component: 'label' });
        app.store?.set('$.data.name' as never, 'Grace' as never);

        // Assert
        expect(written).toEqual([]);
        expect(outside.map((error) => error.code)).toEqual(['SUI-RUN-WRITE']);
        expect(unknown.map((error) => error.code)).toEqual(['SUI-RUN-WRITE']);
        expect(app.store?.get('$.screens.home.children.note.text')).toBe('Grace');
        expect(app.removeNode('$.screens.home.children.note')).toBe(true);
        expect(app.store?.get('$.screens.home.children.note')).toBeUndefined();
        expect(app.removeNode('$.route.screen')).toBe(false);
        expect(containers(host)).toEqual({ home: false });
    });

    it('should leave apps without screens without a route, and say why navigate cannot run', () => {
        // Arrange
        const doc = { app: { component: 'panel', children: { header: { component: 'label', text: 'Shop' } } } } as unknown as AppDocument;

        // Act
        const { app, host } = start(doc);

        // Assert
        expect(app.store?.get('$.route')).toBeUndefined();
        expect(app.visibleScreen()).toBeUndefined();
        expect(app.navigate('home')).toBe('the app has no screens, so it cannot navigate to "home"');
        expect(containers(host)).toEqual({});
    });

    it('should remove the screen containers on dispose', () => {
        // Arrange
        const { app, host } = start();
        app.navigate('product', { id: 'p2' });

        // Act
        app.dispose();

        // Assert
        expect(containers(host)).toEqual({});
        expect(app.navigate('home')).toBe('the app is disposed, so it cannot navigate to "home"');
    });

    it('should run navigate from the logic and let the logic see the route change', async () => {
        // Arrange
        const doc = copy();
        (doc as unknown as Record<string, unknown>)['logic'] = {
            rules: {
                open: { when: { path: '$.data.pick' }, do: [{ command: 'navigate', target: 'product', value: { id: '{{ $trigger }}' } }] },
                seen: { when: { path: '$.route.screen', is: 'product' }, do: [{ command: 'set', target: '$.data.seen', value: true }] }
            }
        };
        (doc.data as Record<string, unknown>)['pick'] = '';
        const { app } = start(doc);

        // Act
        app.store?.set('$.data.pick' as never, 'p9' as never);
        await Promise.resolve();
        await Promise.resolve();

        // Assert
        expect(app.store?.get('$.route')).toEqual({ screen: 'product', params: { id: 'p9' } });
        expect(app.visibleScreen()).toBe('product');
        expect(app.store?.get('$.data.seen')).toBe(true);
    });
});

describe('startScreens', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('should put the containers in the host without an outlet and record which one is visible', () => {
        // Arrange
        const host = document.body.appendChild(document.createElement('div'));
        const store = createStore({ route: { screen: 'a', params: {} } });
        store.protect('$.route');
        const view = startScreens({ host, store: store as never, screens: ['a', 'b'] });

        // Act
        const first = view.visible();
        writeRoute(store as never, '$.route.screen', 'b');
        const second = view.visible();
        writeRoute(store as never, '$.route.screen', 'nowhere');

        // Assert
        expect(first).toBe('a');
        expect(second).toBe('b');
        expect(view.visible()).toBeUndefined();
        expect(containers(host)).toEqual({ a: true, b: true });
        expect(store.set('$.route.screen', 'a')).toBe(false);
        view.dispose();
        expect(containers(host)).toEqual({});
    });
});
