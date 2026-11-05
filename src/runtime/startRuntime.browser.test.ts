import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../core/resolve/index.js';
import { parseShape } from '../core/shape/index.js';
import type { Shape } from '../core/shape/index.js';
import type { AppDocument } from '../core/types.js';
import { MAX_ICON_PATH_LENGTH, PROTOCOL_VERSION } from './protocol.js';
import { startRuntime } from './index.js';
import type { RuntimeHandle } from './index.js';

const NONCE = 'nonce-1';

function shapeOf(properties: Record<string, unknown>, events: string[] = [], commands: string[] = []): Shape {
    const result = parseShape({ summary: 'Fixture', properties, events, commands }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const library: ComponentLibrary = {
    panel: { tier: 'root', tag: 'x-rt-panel', shape: shapeOf({ children: { type: 'map', items: 'string', default: {} } }) },
    label: { tier: 'root', tag: 'x-rt-label', shape: shapeOf({ text: { type: 'string', default: '' } }) },
    badge: { tier: 'root', tag: 'x-rt-badge', shape: shapeOf({ text: { type: 'string', default: '' } }) },
    input: {
        tier: 'root',
        tag: 'x-rt-input',
        shape: shapeOf({ value: { type: 'string', default: '' }, inputType: { type: 'string', default: 'text' } }, ['press'])
    },
    heading: { tier: 'root', tag: 'x-rt-heading', shape: shapeOf({ _text: { type: 'string', kind: 'content', default: 'Heading' } }) },
    modal: { tier: 'root', tag: 'x-rt-modal', shape: shapeOf({ title: { type: 'string', default: '' } }, [], ['open', 'toast']) },
    button: { tier: 'root', tag: 'x-rt-button', shape: shapeOf({ enabled: { type: 'boolean', default: true } }, ['press']) },
    counter: {
        tier: 'root',
        tag: 'x-rt-counter',
        shape: shapeOf({ count: { type: 'number', default: 0, runtime: true }, label: { type: 'string', default: '' }, note: { type: 'string' } })
    },
    outlet: { tier: 'root', tag: 'x-rt-outlet', shape: shapeOf({}) },
    picker: { tier: 'root', tag: 'x-rt-picker', shape: shapeOf({ current: { type: 'string', runtime: true, exposed: true, default: '' } }) }
};

defineComponent({
    tag: 'x-rt-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-rt-label', template: '<p>label:{{ $.text }}</p>' });
defineComponent({ tag: 'x-rt-badge', template: '<p>badge:{{ $.text }}</p>' });
defineComponent({ tag: 'x-rt-input', template: '<i>input</i>' });
defineComponent({ tag: 'x-rt-heading', template: '<h1>{{ $._text }}</h1>' });
defineComponent({ tag: 'x-rt-modal', template: '<dialog>modal</dialog>' });
defineComponent({ tag: 'x-rt-button', template: '<b>button</b>' });
/** The test stand-in for the outlet component: it shows the screen containers put in it */
defineComponent({ tag: 'x-rt-outlet', template: '<section><slot></slot></section>' });
/** Computes its runtime property `count` on every mount, as a record view counts its records */
defineComponent({
    tag: 'x-rt-counter',
    template: '<p>count:{{ $.count }} note:{{ $.note }}</p>',
    controller: ({ store, basePath }) => {
        store.set(`${basePath}.count`, 3);
        return {};
    }
});

/** Writes its exposed property `current` in its runtime branch when it starts, as a list exposes its selection */
defineComponent({
    tag: 'x-rt-picker',
    template: '<p>picker</p>',
    controller: ({ store, basePath }) => {
        const segments = `$.runtime.nodes.${basePath.slice(2)}`.split('.');
        for (let length = 3; length <= segments.length; length += 1) {
            const prefix = segments.slice(0, length).join('.');
            if (store.get(prefix) === undefined) store.set(prefix, {});
        }
        store.set(`${segments.join('.')}.current`, 'picked');
        return {};
    }
});

function textOf(root: ParentNode): string {
    let text = '';
    for (const child of Array.from(root.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
        else if (child instanceof Element) {
            text += child.shadowRoot ? textOf(child.shadowRoot) : '';
            text += textOf(child);
        }
    }
    return text;
}

function find(root: ParentNode, tag: string): Element | undefined {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate;
        const inner = candidate.shadowRoot ? find(candidate.shadowRoot, tag) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

const panel = (children: Record<string, unknown>) => ({ component: 'panel', children }) as AppDocument['app'];

interface Posted {
    type: string;
    nonce: string;
    [key: string]: unknown;
}

describe('startRuntime in Chromium', () => {
    let host: HTMLElement;
    let handle: RuntimeHandle;
    let postMessage: ReturnType<typeof vi.fn<(message: unknown, origin: string) => void>>;
    let parent: { postMessage: typeof postMessage };
    let errorSpy: ReturnType<typeof vi.spyOn>;

    const posted = (): Posted[] => postMessage.mock.calls.map((call) => call[0] as Posted);
    const ofType = (type: string): Posted[] => posted().filter((message) => message.type === type);

    function send(data: unknown, source: unknown = parent): void {
        const event = new MessageEvent('message', { data });
        Object.defineProperty(event, 'source', { value: source });
        window.dispatchEvent(event);
    }

    const message = (type: string, fields: Record<string, unknown> = {}) => ({ v: PROTOCOL_VERSION, nonce: NONCE, type, ...fields });

    const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        host = document.body.appendChild(document.createElement('div'));
        postMessage = vi.fn<(message: unknown, origin: string) => void>();
        parent = { postMessage };
        handle = startRuntime(window, parent, NONCE, library, { host, componentOverlays: { heading: { de: { _text: 'Ueberschrift' } } } });
    });

    afterEach(() => {
        handle.dispose();
        errorSpy.mockRestore();
        document.body.replaceChildren();
    });

    it('should mount on load and post ready', () => {
        // Arrange
        const document: AppDocument = { data: { name: 'Ada' }, app: panel({ hello: { component: 'label', '<-text': '$.data.name' } }) };

        // Act
        send(message('load', { document }));

        // Assert
        expect(ofType('ready')).toHaveLength(1);
        expect(ofType('error')).toHaveLength(0);
        expect(textOf(host)).toContain('label:Ada');
        expect(postMessage.mock.calls[0]?.[1]).toBe('*');
    });

    it('should put the state over the document and the icons into $.runtime.icons before rendering', async () => {
        // Arrange
        const document: AppDocument = { data: { name: 'Ada' }, app: panel({ hello: { component: 'label', '<-text': '$.data.name' } }) };
        const icons = { star: { outline: ['M12 2l3 7h7z'] } };

        // Act
        send(message('load', { document, state: { data: { name: 'Grace' }, app: {} }, icons }));
        await tick();

        // Assert
        expect(textOf(host)).toContain('label:Grace');
        expect(ofType('change')).toHaveLength(0);
    });

    it('should replace the document data with the state data, so a shorter list and a removed key stay gone', async () => {
        // Arrange
        const document: AppDocument = {
            data: { rows: ['a', 'b', 'c', 'd'], map: { k1: 'one', k2: 'two' }, name: 'Ada' },
            app: panel({
                hello: { component: 'label', '<-text': '$.data.name' },
                second: { component: 'badge', '<-text': '$.data.rows.1' },
                third: { component: 'badge', '<-text': '$.data.rows.2' },
                gone: { component: 'badge', '<-text': '$.data.map.k2' }
            })
        };

        // Act
        send(message('load', { document, state: { data: { rows: ['x', 'y'], map: { k1: 'uno' }, name: 'Grace' }, app: {} } }));
        await tick();

        // Assert
        const text = textOf(host);
        expect(text).toContain('label:Grace');
        expect(text).toContain('badge:y');
        expect(text).not.toContain('badge:c');
        expect(text).not.toContain('badge:two');
        expect(ofType('change')).toHaveLength(0);
    });

    it('should post one change for a user edit, with an id and no base', async () => {
        // Arrange
        const document: AppDocument = {
            data: { name: 'Ada' },
            app: panel({ go: { component: 'button', on: { press: { command: 'set', target: '$.data.name', value: 'Linus' } } } })
        };
        send(message('load', { document }));

        // Act
        find(host, 'x-rt-button')?.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));
        await tick();

        // Assert
        const changes = ofType('change');
        expect(changes).toHaveLength(1);
        expect(changes[0]?.['change']).toEqual({ id: expect.any(String), path: '$.data.name', op: 'set', value: 'Linus' });
    });

    it('should post nothing for a host write', async () => {
        // Arrange
        const document: AppDocument = {
            data: { name: 'Ada' },
            app: panel({ hello: { component: 'label', '<-text': '$.data.name' }, other: { component: 'label', text: 'a' } })
        };
        send(message('load', { document }));

        // Act
        send(message('write', { writes: [{ path: '$.data.name', value: 'Hopper' }, { path: '$.app.children.other.text', value: 'x' }] }));
        await tick();

        // Assert
        expect(textOf(host)).toContain('label:Hopper');
        expect(textOf(host)).toContain('label:x');
        expect(ofType('change')).toHaveLength(0);
    });

    it('should neither post nor restore a runtime property of a node', async () => {
        // Arrange
        const document: AppDocument = { data: {}, app: panel({ rows: { component: 'counter' } }) };
        const stale = { data: {}, app: { children: { rows: { count: 0, label: 'kept' } } } };

        // Act
        send(message('load', { document, state: stale }));
        await tick();
        send(message('write', { writes: [{ path: '$.app.children.rows.count', value: 0 }] }));
        await tick();

        // Assert
        expect(textOf(host)).toContain('count:3');
        expect(ofType('change').map((posted) => (posted['change'] as { path: string }).path)).not.toContain('$.app.children.rows.count');
        expect(ofType('error')).toHaveLength(0);
    });

    it('should put a snapshot property the document does not set on its node, and skip a node that is gone', async () => {
        // Arrange
        const document: AppDocument = { data: {}, app: panel({ rows: { component: 'counter' } }) };
        const snapshot = { data: {}, app: { children: { rows: { note: 'filled', other: 'x' }, gone: { label: 'old' } } } };

        // Act
        send(message('load', { document, state: snapshot }));
        await tick();

        // Assert
        expect(textOf(host)).toContain('note:filled');
        expect(textOf(host)).not.toContain('old');
        expect(ofType('error')).toHaveLength(0);
    });

    it('should show a sync status write in a linked node', async () => {
        // Arrange
        const document: AppDocument = { app: panel({ status: { component: 'label', '<-text': '$.runtime.sync.status' } }) };
        send(message('load', { document, mode: 'full' }));
        const initial = textOf(host);

        // Act
        send(message('write', { writes: [{ path: '$.runtime.sync', value: { mode: 'full', status: 'offline', waiting: 3 } }] }));
        await tick();

        // Assert
        expect(initial).toContain('label:connecting');
        expect(textOf(host)).toContain('label:offline');
        expect(ofType('change')).toHaveLength(0);
        expect(handle.stats().dropped.invalid).toBe(0);
    });

    it('should start a Standalone app with the standalone status and refuse $.server in it', () => {
        // Arrange
        const status: AppDocument = { app: panel({ status: { component: 'label', '<-text': '$.runtime.sync.status' } }) };
        const secret: AppDocument = {
            app: panel({ go: { component: 'button', on: { press: { command: 'set', target: '$.server.token', value: 'x' } } } })
        };

        // Act
        send(message('load', { document: status }));
        const text = textOf(host);
        send(message('load', { document: secret, mode: 'persisted' }));

        // Assert
        expect(text).toContain('label:standalone');
        const errors = ofType('error').flatMap((entry) => entry['errors'] as { code: string }[]);
        expect(errors.map((error) => error.code)).toContain('SUI-DOC-SERVER');
        expect(ofType('ready')).toHaveLength(1);
    });

    it('should run the root on entry for sync.rejected with the payload', () => {
        // Arrange
        const document: AppDocument = {
            app: { ...panel({}), on: { 'sync.rejected': { command: 'emit', target: 'rejected' } } } as AppDocument['app']
        };
        send(message('load', { document, mode: 'full' }));

        // Act
        send(message('event', { name: 'sync.rejected', payload: { path: '$.data.stock', reason: 'sold out' } }));

        // Assert
        expect(ofType('error')).toHaveLength(0);
        expect(ofType('emit')).toEqual([
            { v: PROTOCOL_VERSION, nonce: NONCE, type: 'emit', name: 'rejected', payload: { path: '$.data.stock', reason: 'sold out' } }
        ]);
    });

    it('should drop an event that is not an app event, and count one while nothing is mounted', () => {
        // Act
        send(message('event', { name: 'sync.rejected' }));
        send(message('event', { name: 'press' }));

        // Assert
        expect(handle.stats().dropped).toMatchObject({ unhandled: 1, invalid: 1 });
    });

    it('should change the DOM on a path write without a reload', () => {
        // Arrange
        const document: AppDocument = { data: { name: 'Ada' }, app: panel({ hello: { component: 'label', '<-text': '$.data.name' } }) };
        send(message('load', { document }));
        const label = find(host, 'x-rt-label');

        // Act
        send(message('write', { writes: [{ path: '$.data.name', value: 'Grace' }] }));

        // Assert
        expect(textOf(host)).toContain('label:Grace');
        expect(find(host, 'x-rt-label')).toBe(label);
        expect(ofType('ready')).toHaveLength(1);
    });

    it('should replace only the node whose component changed', () => {
        // Arrange
        const document: AppDocument = {
            app: panel({ one: { component: 'label', text: 'a' }, two: { component: 'label', text: 'b' } })
        };
        send(message('load', { document }));
        const labels = Array.from(host.querySelectorAll('*')).length;
        const before = find(host, 'x-rt-label');

        // Act
        send(message('write', { writes: [{ path: '$.app.children.two.component', value: 'badge' }] }));

        // Assert
        expect(labels).toBeGreaterThan(0);
        expect(textOf(host)).toContain('badge:b');
        expect(textOf(host)).toContain('label:a');
        expect(find(host, 'x-rt-label')).toBe(before);
    });

    it('should remount a node whose component changes to one with children', async () => {
        // Arrange
        const document: AppDocument = {
            app: panel({ kpis: panel({ cash: { component: 'label', text: 'cash' }, other: { component: 'label', text: 'o' } }) })
        };
        send(message('load', { document }));
        const writes = [{ path: '$.app.children.kpis.children.cash', value: panel({ inner: { component: 'badge', text: 'deep' } }) }];

        // Act
        send(message('write', { writes }));
        await tick();

        // Assert
        expect(ofType('error')).toEqual([]);
        expect(errorSpy).not.toHaveBeenCalled();
        expect(textOf(host)).toContain('badge:deep');
        expect(textOf(host)).not.toContain('label:cash');
        expect(textOf(host)).toContain('label:o');
    });

    describe('a node written after load', () => {
        const DOCUMENT: AppDocument = Object.freeze({
            data: Object.freeze({ total: 'ten', other: 'eleven' }),
            app: Object.freeze(
                panel({
                    source: Object.freeze({ component: 'picker' }),
                    stat: Object.freeze({ component: 'label', '<-text': '$.data.total' })
                })
            )
        }) as AppDocument;

        const load = async (): Promise<void> => {
            send(message('load', { document: JSON.parse(JSON.stringify(DOCUMENT)) }));
            await tick();
        };
        const write = async (writes: unknown[]): Promise<void> => {
            send(message('write', { writes }));
            await tick();
        };

        it('should apply the links of a node swapped for another component', async () => {
            // Arrange
            await load();

            // Act
            await write([{ path: '$.app.children.stat', value: { component: 'badge', '<-text': '$.data.other' } }]);

            // Assert
            expect(JSON.stringify(ofType('error'))).toBe('[]');
            expect(textOf(host)).toContain('badge:eleven');
            expect(textOf(host)).not.toContain('label:ten');
        });

        it('should apply the links and defaults of a new node', async () => {
            // Arrange
            await load();

            // Act
            await write([{ path: '$.app.children.added', value: { component: 'badge', '<-text': '$.data.total' } }, { path: '$.app.children.titled', value: { component: 'heading' } }]);

            // Assert
            expect(ofType('error')).toEqual([]);
            expect(textOf(host)).toContain('badge:ten');
            expect(textOf(host)).toContain('Heading');
        });

        it('should drop the links of the node it replaces', async () => {
            // Arrange
            await load();
            await write([{ path: '$.app.children.stat', value: { component: 'label', text: 'plain' } }]);

            // Act
            await write([{ path: '$.data.total', value: 'changed' }]);

            // Assert
            expect(ofType('error')).toEqual([]);
            expect(textOf(host)).toContain('label:plain');
            expect(textOf(host)).not.toContain('changed');
        });

        it('should drop the links of a removed node', async () => {
            // Arrange
            await load();

            // Act
            await write([{ path: '$.app.children.stat', remove: true }]);
            await write([{ path: '$.data.total', value: 'changed' }]);

            // Assert
            expect(ofType('error')).toEqual([]);
            expect(textOf(host)).not.toContain('ten');
            expect(textOf(host)).not.toContain('changed');
        });

        it('should resolve a node reference to a node outside the written node', async () => {
            // Arrange
            await load();

            // Act
            await write([{ path: '$.app.children.stat', value: { component: 'badge', '<-text': '^source.current' } }]);

            // Assert
            expect(JSON.stringify(ofType('error'))).toBe('[]');
            expect(textOf(host)).toContain('badge:picked');
        });
    });

    it('should accept the icons of a write', () => {
        // Arrange
        send(message('load', { document: { app: panel({}) }, icons: { star: { outline: ['M0 0h24'] } } }));

        // Act
        send(message('write', { writes: [], icons: { heart: { outline: ['M1 1h2'] } } }));

        // Assert
        expect(ofType('error')).toHaveLength(0);
        expect(handle.stats().dropped).toEqual({ invalid: 0, unknown: 0, oversized: 0, unhandled: 0, foreign: 0 });
    });

    it('should drop an icons map that holds more than path data', () => {
        // Arrange
        send(message('load', { document: { app: panel({}) } }));

        // Act
        send(message('write', { writes: [], icons: { bad: { outline: ['<script>alert(1)</script>'] } } }));
        send(message('write', { writes: [], icons: { big: { outline: ['M'.repeat(MAX_ICON_PATH_LENGTH + 1)] } } }));

        // Assert
        expect(handle.stats().dropped.invalid).toBe(2);
    });

    it('should ignore messages from another source or with another nonce', () => {
        // Arrange
        const document: AppDocument = { app: panel({}) };

        // Act
        send(message('load', { document }), { postMessage: vi.fn() });
        send({ ...message('load', { document }), nonce: 'other' });

        // Assert
        expect(postMessage).not.toHaveBeenCalled();
        expect(handle.stats().dropped.foreign).toBe(2);
    });

    it('should drop unknown, malformed and oversized messages and count them', () => {
        // Arrange
        const big = { v: PROTOCOL_VERSION, nonce: NONCE, type: 'locale', locale: 'x'.repeat(5000) };

        // Act
        send(message('explode'));
        send('text');
        send(message('ping', { id: 'x' }));
        send(big);

        // Assert
        expect(postMessage).not.toHaveBeenCalled();
        expect(handle.stats().dropped).toEqual({ invalid: 2, unknown: 1, oversized: 1, unhandled: 0, foreign: 0 });
    });

    it('should count command, locale, theme and write as unhandled while no application is mounted', () => {
        // Act
        send(message('command', { target: '$.app', command: 'open' }));
        send(message('locale', { locale: 'de' }));
        send(message('theme', { kind: 'mode', name: 'dark' }));
        send(message('write', { writes: [] }));

        // Assert
        expect(handle.stats().dropped.unhandled).toBe(4);
        expect(posted()).toEqual([]);
    });

    describe('command, locale and theme', () => {
        type Commanded = HTMLElement & { commands?: Record<string, (value: unknown) => void> };

        const modalDoc = (): AppDocument => ({
            data: { name: 'Ada' },
            app: panel({
                greeting: { component: 'heading' },
                who: { component: 'label', '<-text': '$.data.name' },
                dlg: { component: 'modal' }
            })
        });
        const errorCodes = (): string[] =>
            ofType('error').flatMap((entry) => (entry['errors'] as { code: string }[]).map((error) => error.code));
        const appRoot = (): Element => host.querySelector('ui-app-root') as Element;

        it('should run a component command on the target element, a modal opens and a toast shows', () => {
            // Arrange
            send(message('load', { document: modalDoc() }));
            const modal = find(host, 'x-rt-modal') as Commanded;
            const open = vi.fn();
            const toast = vi.fn();
            modal.commands = { open, toast };

            // Act
            send(message('command', { target: '$.app.children.dlg', command: 'open' }));
            send(message('command', { target: '$.app.children.dlg', command: 'toast', value: { text: 'Saved' } }));

            // Assert
            expect(open).toHaveBeenCalledTimes(1);
            expect(toast).toHaveBeenCalledWith({ text: 'Saved' }, undefined);
            expect(ofType('error')).toHaveLength(0);
        });

        it('should post error and change nothing for an unknown target, an undeclared command and a system command', () => {
            // Arrange
            send(message('load', { document: modalDoc() }));
            const modal = find(host, 'x-rt-modal') as Commanded;
            const open = vi.fn();
            modal.commands = { open };

            // Act
            send(message('command', { target: '$.app.children.nope', command: 'open' }));
            send(message('command', { target: '$.app.children.dlg', command: 'explode' }));
            send(message('command', { target: '$.data.name', command: 'set', value: 'x' }));

            // Assert
            expect(errorCodes()).toEqual(['SUI-RUN-ON-TARGET', 'SUI-RUN-ON-COMMAND', 'SUI-RUN-ON-COMMAND']);
            expect(open).not.toHaveBeenCalled();
            expect(ofType('change')).toHaveLength(0);
            expect(textOf(host)).toContain('label:Ada');
        });

        it('should navigate with a navigate command message and run a component command on a node of a screen', () => {
            // Arrange
            const document = {
                app: panel({ greeting: { component: 'heading' }, main: { component: 'outlet' } }),
                screens: {
                    home: { title: 'Home', root: panel({ who: { component: 'label', text: 'home' } }) },
                    detail: { title: 'Detail', params: { id: { type: 'string', required: true } }, root: panel({ dlg: { component: 'modal' } }) }
                },
                start: 'home'
            } as unknown as AppDocument;
            send(message('load', { document }));
            const visible = (): string[] =>
                Array.from((find(host, 'x-rt-outlet') as Element).querySelectorAll('[data-sui-screen]'))
                    .filter((element) => !(element as HTMLElement).hidden)
                    .map((element) => element.getAttribute('data-sui-screen') as string);

            // Act
            send(message('command', { target: 'detail', command: 'navigate', value: { id: 'd1' } }));
            const modal = find(host, 'x-rt-modal') as Commanded;
            const open = vi.fn();
            modal.commands = { open };
            send(message('command', { target: '$.screens.detail.children.dlg', command: 'open' }));
            send(message('command', { target: 'nowhere', command: 'navigate' }));
            send(message('command', { target: 'detail', command: 'navigate', value: {} }));

            // Assert
            expect(visible()).toEqual(['detail']);
            expect(open).toHaveBeenCalledTimes(1);
            expect(errorCodes()).toEqual(['SUI-RUN-ON-COMMAND', 'SUI-RUN-ON-COMMAND']);
        });

        it('should switch the language of every screen with a locale message, a hidden one and one mounted later included', async () => {
            // Arrange
            const document = {
                app: panel({ greeting: { component: 'heading' }, main: { component: 'outlet' } }),
                screens: {
                    home: { root: panel({ title: { component: 'heading' } }) },
                    detail: { root: panel({ name: { component: 'heading', _text: 'Detail' } }), locales: { de: { children: { name: { _text: 'Einzelheit' } } } } }
                },
                start: 'home'
            } as unknown as AppDocument;
            send(message('load', { document }));

            // Act
            send(message('locale', { locale: 'de' }));
            send(message('command', { target: 'detail', command: 'navigate' }));
            await tick();
            const german = textOf(host);
            send(message('locale', { locale: 'en' }));
            await tick();

            // Assert
            expect(german.match(/Ueberschrift/g)).toHaveLength(2);
            expect(german).toContain('Einzelheit');
            expect(textOf(host)).not.toContain('Ueberschrift');
            expect(textOf(host)).toContain('Detail');
            expect(ofType('error')).toHaveLength(0);
        });

        it('should change the text content with a locale overlay and leave $.data unchanged', async () => {
            // Arrange
            send(message('load', { document: modalDoc() }));
            send(message('write', { writes: [{ path: '$.data.name', value: 'Grace' }] }));

            // Act
            send(message('locale', { locale: 'de' }));
            await tick();

            // Assert
            expect(textOf(host)).toContain('Ueberschrift');
            expect(textOf(host)).toContain('label:Grace');
            expect(ofType('error')).toHaveLength(0);
            const paths = ofType('change').map((entry) => (entry['change'] as { path: string }).path);
            expect(paths.filter((path) => path.startsWith('$.data'))).toEqual([]);
        });

        it('should post error for a language with no overlay', () => {
            // Arrange
            send(message('load', { document: modalDoc() }));

            // Act
            send(message('locale', { locale: 'fr' }));

            // Assert
            expect(errorCodes()).toEqual(['SUI-LOCALE-UNKNOWN']);
            expect(textOf(host)).toContain('Heading');
        });

        it('should change a token with the dark mode overlay and go back with light', () => {
            // Arrange
            send(message('load', { document: modalDoc() }));
            const surface = (): string => getComputedStyle(appRoot()).getPropertyValue('--ui-color-surface-base').trim();
            const light = surface();

            // Act
            send(message('theme', { kind: 'mode', name: 'dark' }));
            const dark = surface();
            send(message('theme', { kind: 'mode', name: 'light' }));

            // Assert
            expect(dark).toBe('#09090b');
            expect(light).not.toBe(dark);
            expect(surface()).toBe(light);
            expect(ofType('error')).toHaveLength(0);
        });

        it('should post error for an unknown theme kind and an unknown theme name', () => {
            // Arrange
            send(message('load', { document: modalDoc() }));

            // Act
            send(message('theme', { kind: 'sparkle', name: 'dark' }));
            send(message('theme', { kind: 'mode', name: 'sepia' }));

            // Assert
            expect(errorCodes()).toEqual(['SUI-THEME-OVERLAY', 'SUI-THEME-OVERLAY']);
        });

        it('should apply an overlay the document defines in themes', () => {
            // Arrange
            const document: AppDocument = { ...modalDoc(), themes: { acme: { kind: 'brand', tokens: { radius: { sm: '3px' } } } } };
            send(message('load', { document }));

            // Act
            send(message('theme', { kind: 'brand', name: 'acme' }));

            // Assert
            expect(ofType('error')).toHaveLength(0);
            expect(getComputedStyle(appRoot()).getPropertyValue('--ui-radius-sm').trim()).toBe('3px');
        });
    });

    it('should answer ping with pong', () => {
        // Act
        send(message('ping', { id: 7 }));

        // Assert
        expect(ofType('pong')).toEqual([{ v: PROTOCOL_VERSION, nonce: NONCE, type: 'pong', id: 7 }]);
    });

    it('should post the validation errors and no ready for a document that does not mount', () => {
        // Arrange
        const document: AppDocument = { app: panel({ ghost: { component: 'ghost' } }) };

        // Act
        send(message('load', { document }));

        // Assert
        expect(ofType('ready')).toHaveLength(0);
        const errors = ofType('error')[0]?.['errors'] as { code: string; statePath?: string }[];
        expect(errors.map((error) => error.code)).toContain('SUI-NODE-UNKNOWN');
    });

    it('should post a runtime error from the dispatcher', () => {
        // Arrange
        const document: AppDocument = {
            data: { name: 'Ada' },
            app: panel({ go: { component: 'button', on: { press: { command: 'toggle', target: '$.data.name' } } } })
        };
        send(message('load', { document }));

        // Act
        find(host, 'x-rt-button')?.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));

        // Assert
        const errors = ofType('error')[0]?.['errors'] as { code: string; statePath?: string }[];
        expect(errors[0]?.code).toBe('SUI-RUN-ON-COMMAND');
        expect(errors[0]?.statePath).toBe('$.app.children.go');
    });

    it('should post a runtime error for an uncaught window error', () => {
        // Arrange
        send(message('load', { document: { app: panel({}) } }));

        // Act
        window.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') }));

        // Assert
        const errors = ofType('error')[0]?.['errors'] as { code: string }[];
        expect(errors[0]?.code).toBe('SUI-RUN-BINDING');
    });

    it('should post no error for a ResizeObserver loop notice', () => {
        // Arrange
        send(message('load', { document: { app: panel({}) } }));

        // Act
        window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }));
        window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop limit exceeded' }));

        // Assert
        expect(ofType('error')).toHaveLength(0);
    });

    it('should post emit from the dispatcher hook', () => {
        // Arrange
        const document: AppDocument = {
            app: panel({ go: { component: 'button', on: { press: { command: 'emit', target: 'saved', value: { id: 3 } } } } })
        };
        send(message('load', { document }));

        // Act
        find(host, 'x-rt-button')?.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));

        // Assert
        expect(ofType('emit')).toEqual([{ v: PROTOCOL_VERSION, nonce: NONCE, type: 'emit', name: 'saved', payload: { id: 3 } }]);
    });

    it('should drop a write to $.runtime as invalid', () => {
        // Arrange
        send(message('load', { document: { app: panel({}) } }));

        // Act
        send(message('write', { writes: [{ path: '$.data.x', remove: true }, { path: '$.runtime.icons', value: {} }] }));

        // Assert
        expect(handle.stats().dropped.invalid).toBe(1);
        expect(ofType('change')).toHaveLength(0);
    });

    it('should never post a password value', async () => {
        // Arrange
        const press = (target: string, value: unknown) => ({ press: { command: 'set', target, value } });
        const document: AppDocument = {
            data: { account: { pw: 'secret-linked', user: 'ada' }, name: 'Ada' },
            app: panel({
                pass: { component: 'input', inputType: 'password', '<-value': '$.data.account.pw', on: press('$.data.account', { pw: 'secret-typed', user: 'grace' }) },
                literal: { component: 'input', inputType: 'password', value: 'hunter2', on: press('.value', 'hunter3') },
                plain: { component: 'input', value: 'visible', on: press('.value', 'shown') }
            })
        };
        send(message('load', { document }));
        const inputs = Array.from(host.querySelectorAll('*')).filter((element) => element.localName === 'x-rt-input');
        const all = (root: ParentNode): Element[] =>
            Array.from(root.querySelectorAll('*')).flatMap((element) => [element, ...(element.shadowRoot ? all(element.shadowRoot) : [])]);
        const fields = inputs.length > 0 ? inputs : all(host).filter((element) => element.localName === 'x-rt-input');

        // Act
        for (const field of fields) field.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));
        await tick();

        // Assert
        expect(fields).toHaveLength(3);
        const changes = ofType('change').map((entry) => entry['change']);
        const text = JSON.stringify(changes);
        expect(text).not.toContain('secret');
        expect(text).not.toContain('hunter');
        expect(changes).toContainEqual(expect.objectContaining({ path: '$.data.account', value: { user: 'grace' } }));
        expect(changes).toContainEqual(expect.objectContaining({ path: '$.app.children.plain.value', value: 'shown' }));
    });

    it('should stop listening after dispose', () => {
        // Arrange
        handle.dispose();

        // Act
        send(message('ping', { id: 1 }));

        // Assert
        expect(postMessage).not.toHaveBeenCalled();
    });
});
