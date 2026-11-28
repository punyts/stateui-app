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
    badge: { tier: 'root', tag: 'x-cr-badge', shape: shapeOf({ text: { type: 'string', default: '' } }) },
    label: { tier: 'root', tag: 'x-cr-label', shape: shapeOf({ _text: { type: 'string', kind: 'content', default: '' } }) }
};

defineComponent({
    tag: 'x-cr-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-cr-label', template: '<p>{{ $._text }}</p>' });
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

    it('should write the state of a node by its id, wherever the node is, and refuse an id no node or two nodes have unless the write is optional', () => {
        // Arrange
        const { host, runtime, posted } = inPage();
        const named: AppDocument = {
            app: {
                component: 'panel',
                children: {
                    first: { component: 'badge', text: 'one', '@id': 'status' },
                    second: { component: 'badge', text: 'two' },
                    group: { component: 'panel', children: { second: { component: 'badge', text: 'three' } } }
                }
            } as AppDocument['app']
        };
        runtime.handle(message('load', { document: named }));

        // Act
        runtime.handle(message('write', { writes: [{ path: '#status.text', value: 'saved' }] }));
        runtime.handle(message('write', { writes: [{ path: '#missing.text', value: 'x' }, { path: '#second.text', value: 'x' }, { path: '#gone.text', value: 'x', optional: true }] }));

        // Assert
        expect(runtime.app()?.store?.get('$.app.children.first.text' as never)).toBe('saved');
        expect(find(host, 'x-cr-badge')?.shadowRoot?.textContent ?? find(host, 'x-cr-badge')?.textContent).toContain('badge:saved');
        const refused = posted.filter((item) => item.type === 'error').flatMap((item) => item['errors'] as { code: string; statePath: string }[]);
        expect(refused.map((error) => [error.code, error.statePath])).toEqual([['SUI-RUN-WRITE', '#missing.text'], ['SUI-RUN-WRITE', '#second.text']]);
        expect(runtime.app()?.store?.get('$.app.children.second.text' as never)).toBe('two');
    });

    it('should refuse a write by an id once a second node carries it, and find the id again in a new document', () => {
        // Arrange
        const { runtime, posted } = inPage();
        const one: AppDocument = { app: { component: 'panel', children: { first: { component: 'badge', text: 'one', '@id': 'status' } } } as AppDocument['app'] };
        const moved: AppDocument = { app: { component: 'panel', children: { group: { component: 'panel', children: { inner: { component: 'badge', text: 'in', '@id': 'status' } } } } } as AppDocument['app'] };
        runtime.handle(message('load', { document: one }));
        runtime.handle(message('write', { writes: [{ path: '#status.text', value: 'first' }] }));

        // Act
        runtime.handle(message('write', { writes: [{ path: '$.app.children.twin', value: { component: 'badge', text: 'twin', '@id': 'status' } }] }));
        runtime.handle(message('write', { writes: [{ path: '#status.text', value: 'second' }] }));
        const refused = posted.filter((item) => item.type === 'error').flatMap((item) => item['errors'] as { code: string; statePath: string }[]);
        runtime.handle(message('load', { document: moved }));
        runtime.handle(message('write', { writes: [{ path: '#status.text', value: 'third' }] }));

        // Assert
        expect(refused.map((error) => [error.code, error.statePath])).toContainEqual(['SUI-RUN-WRITE', '#status.text']);
        expect(runtime.app()?.store?.get('$.app.children.group.children.inner.text' as never)).toBe('third');
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

    it('should find the node at a point under an element of the page laid over the app, as an editor lays its layer', () => {
        // Arrange
        const { host, runtime, posted } = inPage();
        runtime.handle(message('load', { document: document_ }));
        const box = (find(host, 'x-cr-badge') as Element).getBoundingClientRect();
        const origin = host.getBoundingClientRect();
        const cover = document.body.appendChild(document.createElement('div'));
        cover.style.cssText = `position: fixed; left: ${origin.x}px; top: ${origin.y}px; width: 400px; height: 200px; z-index: 5`;
        const at = { x: box.x - origin.x + 4, y: box.y - origin.y + box.height / 2 };

        // Act
        runtime.handle(message('inspect', { id: 4, at }));

        // Assert
        expect(document.elementFromPoint(box.x + 4, box.y + box.height / 2)).toBe(cover);
        const [answer] = posted.filter((item) => item.type === 'inspected') as unknown as Inspected[];
        expect(answer?.at).toBe('$.app.children.first');
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

    it('should find its own nodes by path when an app before it in the page has the same paths', () => {
        // Arrange: two apps with the same paths, the other one first in the page
        const other = inPage();
        const mine = inPage();
        other.runtime.handle(message('load', { document: document_ }));
        mine.runtime.handle(message('load', { document: document_ }));
        const box = (find(mine.host, 'x-cr-badge') as Element).getBoundingClientRect();
        const origin = mine.host.getBoundingClientRect();

        // Act
        mine.runtime.handle(message('inspect', { id: 5, paths: ['$.app.children.first'] }));

        // Assert
        const [answer] = mine.posted.filter((item) => item.type === 'inspected') as unknown as Inspected[];
        expect(answer?.nodes.map((node) => node.path)).toEqual(['$.app.children.first']);
        expect(answer?.nodes[0]?.rect.y).toBeCloseTo(box.y - origin.y, 0);
    });

    it('should show a load in the language it names after another runtime of the page was made and loaded', () => {
        // Arrange: an app with German, loaded in German, then a second runtime in the same page with an app of its own
        const translated: AppDocument = {
            app: { component: 'panel', children: { first: { component: 'label', _text: 'one' } } } as AppDocument['app'],
            locales: { de: { children: { first: { _text: 'eins' } } } }
        };
        const mine = inPage();
        mine.runtime.handle(message('load', { document: translated, locale: 'de' }));
        const other = inPage();
        other.runtime.handle(message('load', { document: document_ }));

        // Act: the first app loaded again, as a host does after the document changed
        mine.runtime.handle(message('load', { document: translated, locale: 'de' }));
        mine.runtime.handle(message('locale', { locale: 'en' }));
        const english = mine.runtime.app()?.store?.get('$.app.children.first._text' as never);
        mine.runtime.handle(message('locale', { locale: 'de' }));

        // Assert: German after the load and after switching back, with no error, and the other app left as it was
        expect(mine.posted.filter((item) => item.type === 'error')).toEqual([]);
        expect(english).toBe('one');
        expect(mine.runtime.app()?.store?.get('$.app.children.first._text' as never)).toBe('eins');
        expect(other.runtime.app()?.store?.get('$.app.children.first.text' as never)).toBe('one');
        expect(other.posted.filter((item) => item.type === 'error')).toEqual([]);
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
        inside.dispatchEvent(new CustomEvent(APP_OPEN_EVENT, { bubbles: true, composed: true, detail: { app: 'shop', live: true, element: inside, onRaised: () => undefined, onNavigate: () => undefined, respond: (given: Promise<EmbeddedApp>) => void (result = given) } }));

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
