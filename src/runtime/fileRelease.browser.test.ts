import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../core/resolve/index.js';
import { parseShape } from '../core/shape/index.js';
import type { AppDocument } from '../core/types.js';
import { FILE_READ_EVENT, FILE_RELEASE_EVENT } from '../dom/index.js';
import type { FileReadRequest, FileReleaseRequest } from '../dom/index.js';
import { FILE_IDLE_TIMEOUT_MS, FILE_RELEASE_TIMEOUT_MS, PROTOCOL_VERSION } from './protocol.js';
import { FileTransferError, startRuntime } from './index.js';
import type { FileData, RuntimeHandle } from './index.js';

const NONCE = 'nonce-rel';
const ID = '0b6e8c1a-3f1e-4a52-9a43-2f4f1c8f2d10';
const realSetTimeout = setTimeout;

const parsed = parseShape(
    { summary: 'Fixture', properties: { text: { type: 'string', default: '' }, src: { type: 'object', default: {} } } },
    'fixture.state.json'
);
if (!parsed.shape) throw new Error(JSON.stringify(parsed.errors));
const library: ComponentLibrary = { label: { tier: 'root', tag: 'x-rel-label', shape: parsed.shape } };
defineComponent({ tag: 'x-rel-label', template: '<p>{{ $.text }}</p>' });

interface Posted {
    type: string;
    requestId?: number;
    id?: string;
    [key: string]: unknown;
}

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

describe('releaseFile in Chromium', () => {
    let host: HTMLElement;
    let handle: RuntimeHandle;
    let postMessage: ReturnType<typeof vi.fn<(message: unknown, origin: string, transfer?: Transferable[]) => void>>;
    let parent: { postMessage: typeof postMessage };
    let errorSpy: ReturnType<typeof vi.spyOn>;
    /** What the fake host answers a fileRelease with; no answer when it returns undefined */
    let releaseWith: (release: Posted) => Record<string, unknown> | undefined;

    const posted = (type: string): Posted[] =>
        postMessage.mock.calls.map((call) => call[0] as Posted).filter((message) => message.type === type);
    const message = (type: string, fields: Record<string, unknown> = {}) => ({ v: PROTOCOL_VERSION, nonce: NONCE, type, ...fields });

    function send(data: unknown, transfer: Transferable[] = []): void {
        const event = new MessageEvent('message', { data: structuredClone(data, { transfer }) });
        Object.defineProperty(event, 'source', { value: parent });
        window.dispatchEvent(event);
    }

    /** The fake host: answers fileRelease with fileReleased and fileRead with the PNG, each on the next task as after a fetch */
    function fakeHost(data: unknown): void {
        const request = data as Posted;
        if (request.type === 'fileRelease') {
            realSetTimeout(() => {
                const fields = releaseWith(request);
                if (fields) send(message('fileReleased', { requestId: request.requestId, ...fields }));
            }, 0);
        }
        if (request.type === 'fileRead') {
            realSetTimeout(() => {
                const buffer = new Uint8Array(PNG).buffer;
                send(message('fileData', { requestId: request.requestId, ok: true, file: { id: ID, name: 'a.png', size: PNG.length, type: 'image/png' }, data: buffer }), [buffer]);
            }, 0);
        }
    }

    /** Raises `ui-file-release` inside the app, as a component does, and gives the promise the dispatcher answered with */
    function raiseRelease(id: string): Promise<void> | undefined {
        let result: Promise<void> | undefined;
        const detail: FileReleaseRequest = { id, respond: (promise) => (result = promise) };
        host.firstElementChild?.dispatchEvent(new CustomEvent(FILE_RELEASE_EVENT, { detail, bubbles: true, composed: true }));
        return result;
    }

    function raiseRead(id: string): Promise<FileData> | undefined {
        let result: Promise<FileData> | undefined;
        const detail: FileReadRequest = { id, respond: (promise) => (result = promise) };
        host.firstElementChild?.dispatchEvent(new CustomEvent(FILE_READ_EVENT, { detail, bubbles: true, composed: true }));
        return result;
    }

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        host = document.body.appendChild(document.createElement('div'));
        releaseWith = () => ({ ok: true });
        postMessage = vi.fn((data: unknown) => fakeHost(data));
        parent = { postMessage };
        handle = startRuntime(window, parent, NONCE, library, { host });
        const app: AppDocument = { data: {}, app: { component: 'label', text: 'hi', src: { id: ID, name: 'a.png', size: PNG.length, type: 'image/png' } } };
        send(message('load', { document: app }));
    });

    afterEach(() => {
        vi.useRealTimers();
        handle.dispose();
        errorSpy.mockRestore();
        document.body.replaceChildren();
    });

    it('should answer ui-file-release through the host: post fileRelease and resolve on an ok fileReleased', async () => {
        // Arrange
        expect(posted('ready')).toHaveLength(1);

        // Act
        const result = raiseRelease(ID);

        // Assert
        expect(result).toBeDefined();
        await expect(result).resolves.toBeUndefined();
        expect(posted('fileRelease')).toEqual([expect.objectContaining({ v: PROTOCOL_VERSION, nonce: NONCE, requestId: 1, id: ID })]);
    });

    it('should reject with the code of a failed fileReleased', async () => {
        // Arrange
        releaseWith = () => ({ ok: false, code: 'offline', message: 'The server could not be reached' });

        // Act
        const error = await raiseRelease(ID)?.catch((failure: unknown) => failure);

        // Assert
        expect(error).toBeInstanceOf(FileTransferError);
        expect(error).toMatchObject({ code: 'offline', message: 'The server could not be reached' });
    });

    it('should resolve a second release of the same file, as the host answers ok for a file that is gone', async () => {
        // Act
        await raiseRelease(ID);
        const again = raiseRelease(ID);

        // Assert
        await expect(again).resolves.toBeUndefined();
        expect(posted('fileRelease').map((release) => release.requestId)).toEqual([1, 2]);
    });

    it('should drop the cached bytes of a released file, so the next read asks the host again', async () => {
        // Arrange
        await raiseRead(ID);
        await raiseRead(ID);
        const readsBefore = posted('fileRead').length;

        // Act
        await raiseRelease(ID);
        await raiseRead(ID);

        // Assert
        expect(readsBefore).toBe(1);
        expect(posted('fileRead')).toHaveLength(2);
    });

    it('should keep the cached bytes when the release fails', async () => {
        // Arrange
        releaseWith = () => ({ ok: false, code: 'internal', message: 'No' });
        await raiseRead(ID);

        // Act
        await raiseRelease(ID)?.catch(() => undefined);
        await raiseRead(ID);

        // Assert
        expect(posted('fileRead')).toHaveLength(1);
    });

    it('should reject with offline when the host does not answer within the idle time of a transfer', async () => {
        // Arrange
        releaseWith = () => undefined;
        vi.useFakeTimers();
        const failure = raiseRelease(ID)?.catch((error: unknown) => error);

        // Act
        await vi.advanceTimersByTimeAsync(FILE_RELEASE_TIMEOUT_MS + 1);

        // Assert
        expect(FILE_RELEASE_TIMEOUT_MS).toBe(FILE_IDLE_TIMEOUT_MS);
        expect(await failure).toMatchObject({ code: 'offline' });
    });

    it('should ignore a fileReleased for an unknown requestId and drop one that carries a file reference', async () => {
        // Arrange
        releaseWith = () => undefined;
        const result = raiseRelease(ID);
        let settled = false;
        void result?.then(
            () => (settled = true),
            () => (settled = true)
        );

        // Act
        send(message('fileReleased', { requestId: 99, ok: true }));
        send(message('fileReleased', { requestId: 1, ok: true, file: { id: ID, name: 'a.png', size: 8, type: 'image/png' } }));
        await new Promise<void>((resolve) => realSetTimeout(resolve, 20));

        // Assert
        expect(settled).toBe(false);
        expect(handle.stats().dropped.invalid).toBe(1);
        send(message('fileReleased', { requestId: 1, ok: true }));
        await expect(result).resolves.toBeUndefined();
    });

    it('should reject a waiting release with cancelled on dispose', async () => {
        // Arrange
        releaseWith = () => undefined;
        const failure = raiseRelease(ID)?.catch((error: unknown) => error);

        // Act
        handle.dispose();

        // Assert
        expect(await failure).toMatchObject({ code: 'cancelled' });
    });
});
