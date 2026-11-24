import { defineComponent } from '@punyts/stateui';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from './index.js';
import type { MountedApp } from './index.js';
import { APP_HOST_ATTRIBUTE } from './pageFill.js';

const shape = parseShape({ summary: 'Fixture', properties: {}, events: [], layout: true }, 'fixture.state.json').shape;
if (!shape) throw new Error('the fixture shape does not parse');

/** The test stand-in for the app component: a box, as the library's app component is */
const library: ComponentLibrary = Object.freeze({ app: { tier: 'root', tag: 'x-fill-app', shape } });
defineComponent({ tag: 'x-fill-app', template: '<div></div>', styles: ':host { display: block; }' });

const DOCUMENT = Object.freeze({ app: { component: 'app' } }) as unknown as AppDocument;

/** The app element `mounted` rendered, below its `display: contents` root */
function appOf(host: Element): Element {
    const root = host.lastElementChild;
    const app = root?.shadowRoot?.querySelector('x-fill-app');
    if (!app) throw new Error('no app element');
    return app;
}

describe('fillPage', () => {
    const apps: MountedApp[] = [];
    const hosts: Element[] = [];

    afterEach(() => {
        for (const app of apps.splice(0)) app.dispose();
        for (const host of hosts.splice(0)) host.remove();
    });

    function mountOn(host: Element): MountedApp {
        const mounted = mountApp(host, DOCUMENT, library);
        if (!mounted.store) throw new Error(JSON.stringify(mounted.errors));
        apps.push(mounted);
        return mounted;
    }

    function hostIn(parent: Element): Element {
        const host = parent.appendChild(document.createElement('div'));
        hosts.push(host);
        return host;
    }

    it('should fill the viewport with an app mounted on an element right below the body', () => {
        // Arrange
        const host = hostIn(document.body);

        // Act
        mountOn(host);

        // Assert
        const rect = appOf(host).getBoundingClientRect();
        expect([rect.left, rect.top, rect.width, rect.height]).toEqual([0, 0, document.documentElement.clientWidth, window.innerHeight]);
    });

    it('should fill the viewport with an app mounted on the body itself', () => {
        // Arrange
        const before = document.body.lastElementChild;

        // Act
        mountOn(document.body);

        // Assert
        expect(document.body.lastElementChild).not.toBe(before);
        const rect = appOf(document.body).getBoundingClientRect();
        expect([rect.width, rect.height]).toEqual([document.documentElement.clientWidth, window.innerHeight]);
    });

    it('should put two apps on the body side by side, each half the width and the full height', () => {
        // Arrange
        const left = hostIn(document.body);
        const right = hostIn(document.body);

        // Act
        mountOn(left);
        mountOn(right);

        // Assert
        const width = document.documentElement.clientWidth;
        const a = appOf(left).getBoundingClientRect();
        const b = appOf(right).getBoundingClientRect();
        expect([a.left, a.width, a.height]).toEqual([0, width / 2, window.innerHeight]);
        expect([b.left, b.width, b.height]).toEqual([width / 2, width / 2, window.innerHeight]);
    });

    it('should keep the size a page gives the host, at the start of its cell', () => {
        // Arrange
        const host = hostIn(document.body);
        host.setAttribute('style', 'inline-size: 300px; block-size: 200px');

        // Act
        mountOn(host);

        // Assert
        const rect = appOf(host).getBoundingClientRect();
        expect([rect.left, rect.top, rect.width, rect.height]).toEqual([0, 0, 300, 200]);
    });

    it('should yield to a page that lays out its own body', () => {
        // Arrange
        const style = document.head.appendChild(document.createElement('style'));
        style.textContent = 'body { display: block; }';
        const host = hostIn(document.body);

        // Act
        mountOn(host);
        const display = getComputedStyle(document.body).display;
        const margin = getComputedStyle(document.body).marginTop;
        style.remove();

        // Assert
        expect(display).toBe('block');
        expect(margin).toBe('0px');
    });

    it('should leave an app deeper in the page to the page, and take the mark off when it is disposed', () => {
        // Arrange
        const outer = hostIn(document.body);
        const host = outer.appendChild(document.createElement('div'));
        outer.setAttribute('style', 'width: 200px');

        // Act
        const mounted = mountOn(host);
        const width = appOf(host).getBoundingClientRect().width;
        mounted.dispose();

        // Assert
        expect(width).toBe(200);
        expect(host.hasAttribute(APP_HOST_ATTRIBUTE)).toBe(false);
        expect(getComputedStyle(document.body).display).toBe('block');
    });
});
