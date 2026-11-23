import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../core/resolve/index.js';
import { parseShape } from '../core/shape/index.js';
import type { AppDocument } from '../core/types.js';
import { FILE_URL_EVENT } from '../dom/index.js';
import type { FileUrlRequest } from '../dom/index.js';
import { PROTOCOL_VERSION } from './protocol.js';
import { startRuntime } from './index.js';
import type { RuntimeHandle } from './index.js';

const NONCE = 'nonce-u';
const ID = '0B6E8C1A-3F1E-4A52-9A43-2F4F1C8F2D10';
const FILES = 'https://magnetic.example/paths/7/apps/5d1c2b3a-0e9f-4a8b-9c7d-6e5f4a3b2c1d/files';
const FIRST = 'Zmlyc3Q.bWFjMQ';
const SECOND = 'c2Vjb25k.bWFjMg';

const parsed = parseShape({ summary: 'Fixture', properties: { text: { type: 'string', default: '' } } }, 'fixture.state.json');
if (!parsed.shape) throw new Error(JSON.stringify(parsed.errors));
const library: ComponentLibrary = { label: { tier: 'root', tag: 'x-fu-label', shape: parsed.shape } };
defineComponent({ tag: 'x-fu-label', template: '<p>{{ $.text }}</p>' });

describe('fileUrl in Chromium', () => {
    let host: HTMLElement;
    let handle: RuntimeHandle;
    let parent: { postMessage: ReturnType<typeof vi.fn> };

    const message = (type: string, fields: Record<string, unknown> = {}) => ({ v: PROTOCOL_VERSION, nonce: NONCE, type, ...fields });
    const app: AppDocument = { data: {}, app: { component: 'label', text: 'hi' } };

    function send(data: unknown): void {
        const event = new MessageEvent('message', { data });
        Object.defineProperty(event, 'source', { value: parent });
        window.dispatchEvent(event);
    }

    /** Raises `ui-file-url` inside the app, as a component does; `answered` is false when nothing responded */
    function raiseUrl(id: string): { answered: boolean; url: string | undefined } {
        const result: { answered: boolean; url: string | undefined } = { answered: false, url: undefined };
        const detail: FileUrlRequest = {
            id,
            respond: (url) => {
                result.answered = true;
                result.url = url;
            }
        };
        host.firstElementChild?.dispatchEvent(new CustomEvent(FILE_URL_EVENT, { detail, bubbles: true, composed: true }));
        return result;
    }

    beforeEach(() => {
        host = document.body.appendChild(document.createElement('div'));
        parent = { postMessage: vi.fn() };
        handle = startRuntime(window, parent, NONCE, library, { host });
    });

    afterEach(() => {
        handle.dispose();
        host.remove();
    });

    it('should give a file URL with the grant of the load, and the grant a later grant message sends', () => {
        // Arrange
        send(message('load', { document: app, files: { url: `${FILES}/`, grant: FIRST } }));

        // Act
        const first = raiseUrl(ID);
        send(message('grant', { grant: SECOND }));
        const second = raiseUrl(ID);

        // Assert
        expect(first).toEqual({ answered: true, url: `${FILES}/${ID.toLowerCase()}?g=${FIRST}` });
        expect(second.url).toBe(`${FILES}/${ID.toLowerCase()}?g=${SECOND}`);
    });

    it('should give a URL without a grant when the load has none, and nothing for an id that is not a UUID', () => {
        // Arrange
        send(message('load', { document: app, files: { url: FILES } }));

        // Act
        const plain = raiseUrl(ID);
        const odd = raiseUrl('../secrets');

        // Assert
        expect(plain.url).toBe(`${FILES}/${ID.toLowerCase()}`);
        expect(odd).toEqual({ answered: true, url: undefined });
    });

    it('should give nothing when the load names no files, even after a grant message, and drop a load with a relative files URL', () => {
        // Arrange
        send(message('load', { document: app }));
        send(message('grant', { grant: FIRST }));

        // Act
        const none = raiseUrl(ID);
        send(message('load', { document: app, files: { url: '/paths/7/apps/a/files', grant: FIRST } }));
        const afterBadLoad = raiseUrl(ID);

        // Assert
        expect(none).toEqual({ answered: true, url: undefined });
        expect(afterBadLoad.url).toBeUndefined();
        expect(handle.stats().dropped.invalid).toBe(1);
    });
});
