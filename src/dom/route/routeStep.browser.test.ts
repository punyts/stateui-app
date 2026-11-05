import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { Shape } from '../../core/shape/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from '../mount/index.js';
import type { MountedApp, MountOptions } from '../mount/index.js';
import { NAVIGATE_EVENT } from './index.js';

function shapeOf(properties: Record<string, unknown>, events: string[] = []): Shape {
    const result = parseShape({ summary: 'Fixture', properties, events }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const library: ComponentLibrary = Object.freeze({
    panel: { tier: 'root', tag: 'x-rts-panel', shape: shapeOf({ children: { type: 'map', items: 'string', default: {} } }) },
    label: { tier: 'root', tag: 'x-rts-label', shape: shapeOf({ text: { type: 'string', default: '' } }) },
    outlet: { tier: 'root', tag: 'x-rts-outlet', shape: shapeOf({}) }
});

defineComponent({
    tag: 'x-rts-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-rts-label', template: '<p>{{ $.text }}</p>' });
defineComponent({ tag: 'x-rts-outlet', template: '<section><slot></slot></section>' });

/** A shell with an outlet, a home screen and a product screen that needs an `id` and takes a `qty` */
const DOCUMENT = Object.freeze({
    app: { component: 'panel', children: { main: { component: 'outlet' } } },
    screens: {
        home: { root: { component: 'panel', children: { title: { component: 'label', text: 'Home' } } } },
        product: {
            params: { id: { type: 'string', required: true }, qty: { type: 'integer', default: 1 } },
            root: { component: 'panel', children: { title: { component: 'label', text: 'Product' } } }
        }
    },
    start: 'home'
});

function copy(): AppDocument {
    return JSON.parse(JSON.stringify(DOCUMENT)) as AppDocument;
}

/** A copy of the route: the store hands out a live view */
function routeOf(app: MountedApp): unknown {
    return JSON.parse(JSON.stringify(app.store?.get('$.route') ?? null));
}

/** The URL of the test page without a fragment */
const bare = (): string => `${location.pathname}${location.search}`;

/** Resolves on the next `popstate`, after the app's own listener ran */
function nextPopState(): Promise<void> {
    return new Promise((resolve) => window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true }));
}

/** Resolves on the next `hashchange`, after the app's own listener ran */
function nextHashChange(): Promise<void> {
    return new Promise((resolve) => window.addEventListener('hashchange', () => setTimeout(resolve, 0), { once: true }));
}

describe('the route step in Chromium', () => {
    const apps: MountedApp[] = [];
    let warnSpy: ReturnType<typeof vi.spyOn>;

    function start(options: MountOptions = {}): { app: MountedApp; host: HTMLElement } {
        const host = document.body.appendChild(document.createElement('div'));
        const app = mountApp(host, copy(), library, {}, options);
        apps.push(app);
        return { app, host };
    }

    beforeEach(() => {
        history.replaceState(null, '', bare());
        warnSpy = vi.spyOn(report, 'warning').mockImplementation(() => undefined);
    });

    afterEach(() => {
        for (const app of apps.splice(0)) app.dispose();
        history.replaceState(null, '', bare());
        warnSpy.mockRestore();
        document.body.replaceChildren();
    });

    it('should write the start screen into the fragment without a history entry, and push one per navigation', () => {
        // Arrange
        const length = history.length;
        const { app } = start();
        const atStart = location.hash;

        // Act
        app.navigate('product', { id: 'p42' });

        // Assert
        expect(atStart).toBe('#/home');
        expect(location.hash).toBe('#/product?id=p42');
        expect(history.length).toBe(length + 1);
    });

    it('should return to the earlier screen with the back button', async () => {
        // Arrange
        const { app } = start();
        app.navigate('product', { id: 'p42', qty: 2 });
        const popped = nextPopState();

        // Act
        history.back();
        await popped;

        // Assert
        expect(routeOf(app)).toEqual({ screen: 'home', params: {} });
        expect(app.visibleScreen()).toBe('home');
        expect(location.hash).toBe('#/home');
    });

    it('should open a deep link with its params in their declared types', () => {
        // Arrange
        history.replaceState(null, '', `${bare()}#/product?id=p7&qty=3`);

        // Act
        const { app } = start();

        // Assert
        expect(app.errors).toEqual([]);
        expect(routeOf(app)).toEqual({ screen: 'product', params: { id: 'p7', qty: 3 } });
        expect(app.visibleScreen()).toBe('product');
    });

    it('should start at the start screen for a deep link whose params do not fit, or that names an unknown screen', () => {
        // Arrange
        const links = ['#/product', '#/product?id=p7&qty=many', '#/cart'];

        // Act
        const routes = links.map((link) => {
            history.replaceState(null, '', `${bare()}${link}`);
            const { app } = start();
            const route = routeOf(app);
            const hash = location.hash;
            app.dispose();
            return { route, hash };
        });

        // Assert
        for (const { route, hash } of routes) {
            expect(route).toEqual({ screen: 'home', params: {} });
            expect(hash).toBe('#/home');
        }
        expect(warnSpy).toHaveBeenCalledTimes(3);
    });

    it('should navigate on a hash changed by hand, and go to start for one it cannot show', async () => {
        // Arrange
        const { app } = start();
        const changed = nextHashChange();

        // Act
        location.hash = '#/product?id=p9';
        await changed;
        const moved = routeOf(app);
        const refused = nextHashChange();
        location.hash = '#/product?qty=2';
        await refused;

        // Assert
        expect(moved).toEqual({ screen: 'product', params: { id: 'p9', qty: 1 } });
        expect(routeOf(app)).toEqual({ screen: 'home', params: {} });
        expect(location.hash).toBe('#/home');
    });

    it('should leave the URL and the history alone with route off', () => {
        // Arrange
        history.replaceState(null, '', `${bare()}#/product?id=p7`);
        const length = history.length;
        const hash = location.hash;
        const { app } = start({ route: false });

        // Act
        app.navigate('product', { id: 'p8' });

        // Assert
        expect(routeOf(app)).toEqual({ screen: 'product', params: { id: 'p8', qty: 1 } });
        expect(history.length).toBe(length);
        expect(location.hash).toBe(hash);
    });

    it('should navigate on a sui-navigate event from an element of the app, and refuse one that does not fit', () => {
        // Arrange
        const { app, host } = start({ route: false });
        const outer = vi.fn();
        document.body.addEventListener(NAVIGATE_EVENT, outer);
        const label = host.querySelector('*') as Element;

        // Act
        label.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { bubbles: true, composed: true, detail: { screen: 'product' } }));
        const refused = routeOf(app);
        label.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { bubbles: true, composed: true, detail: { screen: 'product', params: { id: 'p3' } } }));

        // Assert
        document.body.removeEventListener(NAVIGATE_EVENT, outer);
        expect(refused).toEqual({ screen: 'home', params: {} });
        expect(routeOf(app)).toEqual({ screen: 'product', params: { id: 'p3', qty: 1 } });
        expect(outer).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('should remove the fragment it wrote on dispose', () => {
        // Arrange
        const { app } = start();
        app.navigate('product', { id: 'p1' });

        // Act
        app.dispose();

        // Assert
        expect(location.hash).toBe('');
    });
});
