import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../core/resolve/index.js';
import { parseShape } from '../core/shape/index.js';
import type { Shape } from '../core/shape/index.js';
import type { AppDocument } from '../core/types.js';
import { APP_OPEN_EVENT } from '../dom/embed/types.js';
import type { AppAsk, AppHost, EmbeddedApp } from '../dom/embed/types.js';
import { PROTOCOL_VERSION } from './protocol.js';
import { createRuntime } from './index.js';
import type { RuntimeCore } from './index.js';

const NONCE = 'nonce-page';

function shapeOf(properties: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Fixture', properties, events: [], commands: [] }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const library: ComponentLibrary = {
    panel: { tier: 'root', tag: 'x-cr-panel', shape: shapeOf({ children: { type: 'map', items: 'string', default: {} } }) },
    badge: { tier: 'root', tag: 'x-cr-badge', shape: shapeOf({ text: { type: 'string', default: '' } }) }
};

defineComponent({
    tag: 'x-cr-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-cr-badge', template: '<p style="display: block; height: 40px; margin: 0">badge:{{ $.text }}</p>' });

function find(root: ParentNode, tag: string): Element | undefined {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate;
        const inner = candidate.shadowRoot ? find(candidate.shadowRoot, tag) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

interface Posted {
    type: string;
    [key: string]: unknown;
}

interface Inspected {
    id: number;
    at?: string;
    nodes: { path: string; rect: { x: number; y: number; width: number; height: number } }[];
}

const document_: AppDocument = {
    app: { component: 'panel', children: { first: { component: 'badge', text: 'one' }, second: { component: 'badge', text: 'two' } } } as AppDocument['app']
};

const message = (type: string, fields: Record<string, unknown> = {}) => ({ v: PROTOCOL_VERSION, nonce: NONCE, type, ...fields });

describe('createRuntime in a page (inPage)', () => {
    const runtimes: RuntimeCore[] = [];
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        for (const runtime of runtimes.splice(0)) runtime.dispose();
        errorSpy.mockRestore();
        document.body.replaceChildren();
    });

    /** A runtime on a new element of the page, drawn at `zoom` of its size, and what it posted */
    function inPage(zoom = 1, apps?: AppHost): { host: HTMLElement; runtime: RuntimeCore; posted: Posted[] } {
        const frame = document.body.appendChild(document.createElement('div'));
        frame.style.cssText = `width: 400px; transform-origin: 0 0; transform: scale(${zoom})`;
        const host = frame.appendChild(document.createElement('div'));
        const posted: Posted[] = [];
        const runtime = createRuntime({ host, nonce: NONCE, library, post: (data) => void posted.push(data as Posted), inPage: true, ...(apps !== undefined && { apps }) });
        runtimes.push(runtime);
        return { host, runtime, posted };
    }

    it('should mount the app embedded on its element and post through its post, leaving the title and history alone', () => {
        // Arrange
        document.title = 'The page';
        const history = window.history.length;
        const { host, runtime, posted } = inPage();

        // Act
        runtime.handle(message('load', { document: document_ }));

        // Assert
        expect(posted.map((item) => item.type)).toContain('ready');
        expect(posted.filter((item) => item.type === 'error')).toEqual([]);
        expect(find(host, 'x-cr-badge')).toBeDefined();
        expect(runtime.app()?.store).toBeDefined();
        expect(document.title).toBe('The page');
        expect(window.history.length).toBe(history);
    });

    it('should answer inspect in the pixels of its element when the page draws it at half its size', () => {
        // Arrange
        const { host, runtime, posted } = inPage(0.5);
        runtime.handle(message('load', { document: document_ }));
        const box = (find(host, 'x-cr-badge') as Element).getBoundingClientRect();
        const origin = host.getBoundingClientRect();
        // The first badge's middle, in the element's own pixels (twice the page's)
        const at = { x: (box.x - origin.x) * 2 + 4, y: (box.y - origin.y + box.height / 2) * 2 };

        // Act
        runtime.handle(message('inspect', { id: 1, at }));
        runtime.handle(message('inspect', { id: 2, paths: ['$.app.children.first'] }));

        // Assert
        const [atPoint, ofPaths] = posted.filter((item) => item.type === 'inspected') as unknown as Inspected[];
        expect(atPoint?.at).toBe('$.app.children.first');
        expect(box.height).toBeGreaterThan(0);
        expect(ofPaths?.nodes[0]?.rect.height).toBeCloseTo(box.height * 2, 0);
        expect(ofPaths?.nodes[0]?.rect.width).toBeCloseTo(box.width * 2, 0);
        expect(ofPaths?.nodes[0]?.rect.y).toBeCloseTo((box.y - origin.y) * 2, 0);
    });

    it('should not take the nodes of another app in the same page as its own', () => {
        // Arrange: two apps with the same paths, one above the other
        const mine = inPage();
        const other = inPage();
        mine.runtime.handle(message('load', { document: document_ }));
        other.runtime.handle(message('load', { document: document_ }));
        const theirs = (find(other.host, 'x-cr-badge') as Element).getBoundingClientRect();
        const origin = mine.host.getBoundingClientRect();

        // Act: a point on the other app's badge, in this app's pixels
        mine.runtime.handle(message('inspect', { id: 3, at: { x: theirs.x - origin.x + 4, y: theirs.y - origin.y + 4 } }));

        // Assert
        const [answer] = mine.posted.filter((item) => item.type === 'inspected') as unknown as Inspected[];
        expect(answer?.at).toBeUndefined();
        expect(answer?.nodes).toEqual([]);
    });

    it('should answer an app asked for inside the loaded app through the app host it was given', async () => {
        // Arrange
        const attached: EmbeddedApp = { navigate: () => undefined, dispose: () => undefined };
        const asks: AppAsk[] = [];
        const apps: AppHost = { open: (ask) => { asks.push(ask); return Promise.resolve({ attach: () => attached }); } };
        const { host, runtime } = inPage(1, apps);
        runtime.handle(message('load', { document: document_ }));
        const inside = (find(host, 'x-cr-badge') as Element).appendChild(document.createElement('div'));
        let result: Promise<EmbeddedApp> | undefined;

        // Act
        inside.dispatchEvent(new CustomEvent(APP_OPEN_EVENT, { bubbles: true, composed: true, detail: { app: 'shop', live: true, element: inside, onEmit: () => undefined, onNavigate: () => undefined, respond: (given: Promise<EmbeddedApp>) => void (result = given) } }));

        // Assert
        expect(await result).toBe(attached);
        expect(asks).toEqual([{ app: 'shop', live: true }]);
    });

    it('should remove the app from its element when disposed', () => {
        // Arrange
        const { host, runtime } = inPage();
        runtime.handle(message('load', { document: document_ }));

        // Act
        runtime.dispose();

        // Assert
        expect(find(host, 'x-cr-badge')).toBeUndefined();
        expect(runtime.app()).toBeUndefined();
    });
});
