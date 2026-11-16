import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../core/resolve/index.js';
import { parseShape } from '../core/shape/index.js';
import type { AppDocument } from '../core/types.js';
import { FILE_READ_EVENT } from '../dom/index.js';
import type { FileReadRequest } from '../dom/index.js';
import { FILE_READ_TIMEOUT_MS, MAX_FILE_BYTES, PROTOCOL_VERSION } from './protocol.js';
import { FileTransferError, startRuntime } from './index.js';
import type { FileData, RuntimeHandle } from './index.js';

const NONCE = 'nonce-r';
const ID = '0b6e8c1a-3f1e-4a52-9a43-2f4f1c8f2d10';
const realSetTimeout = setTimeout;

const parsed = parseShape(
    { summary: 'Fixture', properties: { text: { type: 'string', default: '' }, src: { type: 'object', default: {} } } },
    'fixture.state.json'
);
if (!parsed.shape) throw new Error(JSON.stringify(parsed.errors));
const library: ComponentLibrary = { label: { tier: 'root', tag: 'x-fr-label', shape: parsed.shape } };
defineComponent({ tag: 'x-fr-label', template: '<p>{{ $.text }}</p>' });

interface Posted {
    type: string;
    requestId?: number;
    id?: string;
    [key: string]: unknown;
}

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

describe('readFile in Chromium', () => {
    let host: HTMLElement;
    let handle: RuntimeHandle;
    let postMessage: ReturnType<typeof vi.fn<(message: unknown, origin: string, transfer?: Transferable[]) => void>>;
    let parent: { postMessage: typeof postMessage };
    let errorSpy: ReturnType<typeof vi.spyOn>;
    /** What the fake host answers a fileRead with; no answer when it returns undefined */
    let answerWith: (read: Posted) => Record<string, unknown> | undefined;
    /** The buffers the fake host transferred */
    let transferred: ArrayBuffer[];

    const posted = (type: string): Posted[] =>
        postMessage.mock.calls.map((call) => call[0] as Posted).filter((message) => message.type === type);
    const message = (type: string, fields: Record<string, unknown> = {}) => ({ v: PROTOCOL_VERSION, nonce: NONCE, type, ...fields });

    function send(data: unknown, transfer: Transferable[] = []): void {
        // A real postMessage moves the buffers: clone with the transfer list as the browser would
        const event = new MessageEvent('message', { data: structuredClone(data, { transfer }) });
        Object.defineProperty(event, 'source', { value: parent });
        window.dispatchEvent(event);
    }

    /** The fake host: answers each fileRead with fileData on the next task, as a real host answers after its fetch */
    function fakeHost(data: unknown): void {
        const read = data as Posted;
        if (read.type !== 'fileRead') return;
        realSetTimeout(() => {
            const fields = answerWith(read);
            if (!fields) return;
            const buffer = fields['data'];
            const transfer = buffer instanceof ArrayBuffer ? [buffer] : [];
            if (buffer instanceof ArrayBuffer) transferred.push(buffer);
            send(message('fileData', { requestId: read.requestId, ...fields }), transfer);
        }, 0);
    }

    /** Raises `ui-file-read` inside the app, as a component does, and gives the promise the dispatcher answered with */
    function raiseRead(id: string, signal?: AbortSignal): Promise<FileData> | undefined {
        let result: Promise<FileData> | undefined;
        const detail: FileReadRequest = { id, ...(signal ? { signal } : {}), respond: (promise) => (result = promise) };
        host.firstElementChild?.dispatchEvent(new CustomEvent(FILE_READ_EVENT, { detail, bubbles: true, composed: true }));
        return result;
    }

    const pngAnswer = () => ({ ok: true, file: { id: ID, name: 'a.png', size: PNG.length, type: 'image/png' }, data: new Uint8Array(PNG).buffer });

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        host = document.body.appendChild(document.createElement('div'));
        transferred = [];
        answerWith = pngAnswer;
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

    it('should answer ui-file-read through the host: post fileRead and resolve with the bytes of fileData', async () => {
        // Arrange
        expect(posted('ready')).toHaveLength(1);

        // Act
        const result = raiseRead(ID);

        // Assert
        expect(result).toBeDefined();
        const read = await result;
        expect(posted('fileRead')).toEqual([expect.objectContaining({ v: PROTOCOL_VERSION, nonce: NONCE, requestId: 1, id: ID })]);
        expect(read?.file).toEqual({ id: ID, name: 'a.png', size: PNG.length, type: 'image/png' });
        expect([...new Uint8Array(read?.data ?? new ArrayBuffer(0))]).toEqual(PNG);
        expect(transferred[0]?.byteLength).toBe(0);
    });

    it('should answer a second read of a file a node uses from the cache, without asking the host', async () => {
        // Arrange
        await raiseRead(ID);

        // Act
        const again = await raiseRead(ID);

        // Assert
        expect(posted('fileRead')).toHaveLength(1);
        expect([...new Uint8Array(again?.data ?? new ArrayBuffer(0))]).toEqual(PNG);
    });

    it('should release the bytes once no node uses the id, so the next read asks the host again', async () => {
        // Arrange
        await raiseRead(ID);

        // Act
        send(message('write', { writes: [{ path: '$.app.src', value: {} }] }));
        await new Promise<void>((resolve) => realSetTimeout(resolve, 1100));
        await raiseRead(ID);

        // Assert
        expect(posted('fileRead')).toHaveLength(2);
    });

    it('should keep the bytes while a node uses the id', async () => {
        // Arrange
        await raiseRead(ID);

        // Act
        send(message('write', { writes: [{ path: '$.app.text', value: 'changed' }] }));
        await new Promise<void>((resolve) => realSetTimeout(resolve, 1100));
        await raiseRead(ID);

        // Assert
        expect(posted('fileRead')).toHaveLength(1);
    });

    it('should reject with the code of a failed fileData', async () => {
        // Arrange
        answerWith = () => ({ ok: false, code: 'not_found', message: 'No file with this id' });

        // Act
        const error = await raiseRead(ID)?.catch((thrown: unknown) => thrown);

        // Assert
        expect(error).toBeInstanceOf(FileTransferError);
        expect(error).toMatchObject({ code: 'not_found' });
    });

    it('should reject with cancelled when the signal aborts', async () => {
        // Arrange
        answerWith = () => undefined;
        const controller = new AbortController();
        const failure = raiseRead(ID, controller.signal)?.catch((thrown: unknown) => thrown);

        // Act
        controller.abort();

        // Assert
        expect(await failure).toMatchObject({ code: 'cancelled' });
    });

    it('should reject with offline when the host does not answer in time', async () => {
        // Arrange
        answerWith = () => undefined;
        vi.useFakeTimers();
        const failure = raiseRead(ID)?.catch((thrown: unknown) => thrown);

        // Act
        await vi.advanceTimersByTimeAsync(FILE_READ_TIMEOUT_MS);

        // Assert
        expect(await failure).toMatchObject({ code: 'offline' });
    });

    it('should drop and count a fileData with an oversized buffer or a size mismatch', () => {
        // Arrange
        const fileData = (size: number, bytes: number) =>
            message('fileData', { requestId: 1, ok: true, file: { id: ID, name: 'a.png', size, type: 'image/png' }, data: new ArrayBuffer(bytes) });

        // Act
        send(fileData(MAX_FILE_BYTES + 1, MAX_FILE_BYTES + 1));
        send(fileData(5, 4));

        // Assert
        expect(handle.stats().dropped).toMatchObject({ oversized: 1, invalid: 1 });
    });

    it('should reject the waiting reads with cancelled on dispose', async () => {
        // Arrange
        answerWith = () => undefined;
        const failure = raiseRead(ID)?.catch((thrown: unknown) => thrown);

        // Act
        handle.dispose();

        // Assert
        expect(await failure).toMatchObject({ code: 'cancelled' });
    });
});
