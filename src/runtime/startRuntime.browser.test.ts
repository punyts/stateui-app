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

function shapeOf(properties: Record<string, unknown>, events: string[] = []): Shape {
    const result = parseShape({ summary: 'Fixture', properties, events }, 'fixture.state.json');
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
        shape: shapeOf({ value: { type: 'string', default: '' }, inputType: { type: 'string', default: 'text' } })
    },
    button: { tier: 'root', tag: 'x-rt-button', shape: shapeOf({ enabled: { type: 'boolean', default: true } }, ['press']) }
};

defineComponent({
    tag: 'x-rt-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-rt-label', template: '<p>label:{{ $.text }}</p>' });
defineComponent({ tag: 'x-rt-badge', template: '<p>badge:{{ $.text }}</p>' });
defineComponent({ tag: 'x-rt-input', template: '<i>input</i>' });
defineComponent({ tag: 'x-rt-button', template: '<b>button</b>' });

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
        handle = startRuntime(window, parent, NONCE, library, { host });
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

    it('should put the state snapshot over the document and the icons into $.runtime.icons before rendering', () => {
        // Arrange
        const document: AppDocument = { data: { name: 'Ada' }, app: panel({ hello: { component: 'label', '<-text': '$.data.name' } }) };
        const icons = { star: { outline: ['M12 2l3 7h7z'] } };

        // Act
        send(message('load', { document, state: { data: { name: 'Grace' }, app: {} }, icons }));
        send(message('write', { writes: [{ path: '$.data.name', value: 'Hopper' }] }));

        // Assert
        expect(textOf(host)).toContain('label:Hopper');
        expect(ofType('snapshot')[0]).toMatchObject({ data: { name: 'Hopper' } });
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
        expect(ofType('snapshot')).toHaveLength(1);
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

    it('should accept the icons of a write and post a snapshot', () => {
        // Arrange
        send(message('load', { document: { app: panel({}) }, icons: { star: { outline: ['M0 0h24'] } } }));

        // Act
        send(message('write', { writes: [], icons: { heart: { outline: ['M1 1h2'] } } }));

        // Assert
        expect(ofType('snapshot')).toHaveLength(1);
        expect(handle.stats().dropped).toEqual({ invalid: 0, unknown: 0, oversized: 0, unhandled: 0, foreign: 0 });
    });

    it('should drop an icons map that holds more than path data', () => {
        // Arrange
        send(message('load', { document: { app: panel({}) } }));

        // Act
        send(message('write', { writes: [], icons: { bad: { outline: ['<script>alert(1)</script>'] } } }));
        send(message('write', { writes: [], icons: { big: { outline: ['M'.repeat(MAX_ICON_PATH_LENGTH + 1)] } } }));

        // Assert
        expect(ofType('snapshot')).toHaveLength(0);
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

    it('should drop command, locale and theme and count them as unhandled', () => {
        // Arrange
        send(message('load', { document: { app: panel({}) } }));

        // Act
        send(message('command', { target: '$.app', command: 'open' }));
        send(message('locale', { locale: 'de' }));
        send(message('theme', { kind: 'mode', name: 'dark' }));

        // Assert
        expect(handle.stats().dropped.unhandled).toBe(3);
        expect(posted().map((entry) => entry.type)).toEqual(['ready']);
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
        expect(ofType('snapshot')).toHaveLength(0);
    });

    it('should never put a password value or a $.runtime path in a snapshot', async () => {
        // Arrange
        const document: AppDocument = {
            data: { pw: 'secret-linked', name: 'Ada' },
            app: panel({
                pass: { component: 'input', inputType: 'password', '<-value': '$.data.pw' },
                literal: { component: 'input', inputType: 'password', value: 'hunter2' },
                plain: { component: 'input', value: 'visible' }
            })
        };
        send(message('load', { document, state: { data: { pw: 'secret-linked', name: 'Ada' }, app: { children: { literal: { value: 'hunter2' } } } } }));

        // Act
        send(message('write', { writes: [{ path: '$.app.children.literal.value', value: 'hunter3' }] }));
        send(message('write', { writes: [{ path: '$.data.name', value: 'Grace' }] }));
        await tick();

        // Assert
        const snapshots = ofType('snapshot');
        expect(snapshots.length).toBeGreaterThanOrEqual(2);
        const text = JSON.stringify(snapshots);
        expect(text).not.toContain('secret-linked');
        expect(text).not.toContain('hunter');
        expect(text).not.toContain('runtime');
        expect(text).toContain('visible');
        expect(text).toContain('Grace');
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
