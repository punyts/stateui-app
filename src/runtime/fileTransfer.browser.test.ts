import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../core/resolve/index.js';
import { parseShape } from '../core/shape/index.js';
import type { AppDocument } from '../core/types.js';
import { registerMountStep } from '../dom/mount/index.js';
import { FILE_IDLE_TIMEOUT_MS, MAX_FILE_BYTES, PROTOCOL_VERSION } from './protocol.js';
import { FileTransferError, startRuntime } from './index.js';
import type { RuntimeHandle, TransferFile } from './index.js';

const NONCE = 'nonce-f';
const realSetTimeout = setTimeout;

const parsed = parseShape({ summary: 'Fixture', properties: { text: { type: 'string', default: '' } } }, 'fixture.state.json');
if (!parsed.shape) throw new Error(JSON.stringify(parsed.errors));
const library: ComponentLibrary = { label: { tier: 'root', tag: 'x-ft-label', shape: parsed.shape } };
defineComponent({ tag: 'x-ft-label', template: '<p>{{ $.text }}</p>' });

interface Posted {
    type: string;
    requestId?: number;
    [key: string]: unknown;
}

describe('transferFile in Chromium', () => {
    let host: HTMLElement;
    let handle: RuntimeHandle;
    let transferFile: TransferFile;
    let transfers: ArrayBuffer[];
    let clones: Posted[];
    let postMessage: ReturnType<typeof vi.fn<(message: unknown, origin: string, transfer?: Transferable[]) => void>>;
    let parent: { postMessage: typeof postMessage };
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let unregister: () => void;

    const posted = (type: string): Posted[] =>
        postMessage.mock.calls.map((call) => call[0] as Posted).filter((message) => message.type === type);
    const message = (type: string, fields: Record<string, unknown> = {}) => ({ v: PROTOCOL_VERSION, nonce: NONCE, type, ...fields });

    function send(data: unknown, source: unknown = parent): void {
        const event = new MessageEvent('message', { data });
        Object.defineProperty(event, 'source', { value: source });
        window.dispatchEvent(event);
    }

    /** Lets the file's bytes be read and the `file` message be posted */
    const settle = () => new Promise<void>((resolve) => realSetTimeout(resolve, 50));
    const fileOf = (text: string, name = 'a.txt', type = 'text/plain') => new File([text], name, { type });
    const reference = { id: 'f1', name: 'a.txt', size: 5, type: 'text/plain' };

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        host = document.body.appendChild(document.createElement('div'));
        transfers = [];
        clones = [];
        postMessage = vi.fn((data: unknown, _origin: string, transfer?: Transferable[]) => {
            if (transfer) {
                clones.push(structuredClone(data, { transfer }) as Posted);
                transfers.push(...(transfer as ArrayBuffer[]));
            }
        });
        parent = { postMessage };
        unregister = registerMountStep('test-capture-hooks', {
            start(context): void {
                const hook = context.hooks.transferFile;
                if (hook) transferFile = hook;
            }
        });
        handle = startRuntime(window, parent, NONCE, library, { host });
        const app: AppDocument = { data: {}, app: { component: 'label', text: 'hi' } };
        send(message('load', { document: app }));
    });

    afterEach(() => {
        vi.useRealTimers();
        unregister();
        handle.dispose();
        errorSpy.mockRestore();
        document.body.replaceChildren();
    });

    it('should resolve with the reference of the fileResult and post the file with its bytes', async () => {
        // Arrange
        const result = transferFile(fileOf('hello'));
        await settle();
        const sent = clones[0];

        // Act
        send(message('fileResult', { requestId: sent?.requestId, ok: true, file: reference }));

        // Assert
        await expect(result).resolves.toEqual(reference);
        expect(sent).toMatchObject({ name: 'a.txt', size: 5, mediaType: 'text/plain', nonce: NONCE });
        expect((sent?.data as ArrayBuffer).byteLength).toBe(5);
    });

    it('should detach the buffer it posted because it was transferred', async () => {
        // Arrange
        const result = transferFile(fileOf('hello'));
        await settle();

        // Act
        const buffer = transfers[0];

        // Assert
        expect(buffer?.byteLength).toBe(0);
        send(message('fileResult', { requestId: posted('file')[0]?.requestId, ok: true, file: reference }));
        await result;
    });

    it('should report progress for each fileProgress', async () => {
        // Arrange
        const onProgress = vi.fn();
        const result = transferFile(fileOf('hello'), { onProgress });
        await settle();
        const requestId = posted('file')[0]?.requestId;

        // Act
        send(message('fileProgress', { requestId, loaded: 2, total: 5 }));
        send(message('fileProgress', { requestId, loaded: 5, total: 5 }));

        // Assert
        expect(onProgress.mock.calls).toEqual([[{ loaded: 2, total: 5 }], [{ loaded: 5, total: 5 }]]);
        send(message('fileResult', { requestId, ok: true, file: reference }));
        await result;
    });

    it('should reject with the code of a failed fileResult', async () => {
        // Arrange
        const result = transferFile(fileOf('hello'));
        const failure = result.catch((error: unknown) => error);
        await settle();

        // Act
        send(message('fileResult', { requestId: posted('file')[0]?.requestId, ok: false, code: 'quota', message: 'Full' }));

        // Assert
        const error = await failure;
        expect(error).toBeInstanceOf(FileTransferError);
        expect(error).toMatchObject({ code: 'quota', message: 'Full' });
    });

    it('should post fileCancel and reject with cancelled when the signal aborts', async () => {
        // Arrange
        const controller = new AbortController();
        const failure = transferFile(fileOf('hello'), { signal: controller.signal }).catch((error: unknown) => error);
        await settle();

        // Act
        controller.abort();

        // Assert
        expect(await failure).toMatchObject({ code: 'cancelled' });
        expect(posted('fileCancel')).toEqual([expect.objectContaining({ requestId: posted('file')[0]?.requestId })]);
    });

    it('should reject with cancelled and post nothing when the signal is already aborted', async () => {
        // Arrange
        const controller = new AbortController();
        controller.abort();

        // Act
        const error = await transferFile(fileOf('hello'), { signal: controller.signal }).catch((thrown: unknown) => thrown);

        // Assert
        expect(error).toMatchObject({ code: 'cancelled' });
        expect(posted('file')).toHaveLength(0);
    });

    it('should reject with offline when nothing arrives for the idle time, counted from the last progress', async () => {
        // Arrange
        vi.useFakeTimers();
        const failure = transferFile(fileOf('hello')).catch((error: unknown) => error);
        await settle();
        const requestId = posted('file')[0]?.requestId;
        let settled = false;
        void failure.then(() => {
            settled = true;
        });

        // Act
        await vi.advanceTimersByTimeAsync(FILE_IDLE_TIMEOUT_MS - 1000);
        send(message('fileProgress', { requestId, loaded: 1, total: 5 }));
        await vi.advanceTimersByTimeAsync(FILE_IDLE_TIMEOUT_MS - 1000);
        const stillWaiting = !settled;
        await vi.advanceTimersByTimeAsync(2000);

        // Assert
        expect(stillWaiting).toBe(true);
        expect(await failure).toMatchObject({ code: 'offline' });
    });

    it('should reject with offline when no progress arrives after the file message', async () => {
        // Arrange
        vi.useFakeTimers();
        const failure = transferFile(fileOf('hello')).catch((error: unknown) => error);
        await settle();

        // Act
        await vi.advanceTimersByTimeAsync(FILE_IDLE_TIMEOUT_MS);

        // Assert
        expect(await failure).toMatchObject({ code: 'offline' });
    });

    it('should reject a file over the limit with too_large and post nothing', async () => {
        // Arrange
        const big = { size: MAX_FILE_BYTES + 1, name: 'big.bin', type: 'application/octet-stream' } as unknown as File;

        // Act
        const error = await transferFile(big).catch((thrown: unknown) => thrown);

        // Assert
        expect(error).toMatchObject({ code: 'too_large' });
        expect(posted('file')).toHaveLength(0);
    });

    it('should drop and count an inbound file message with an oversized buffer or a size mismatch', () => {
        // Arrange
        const file = (size: number, bytes: number) =>
            message('file', { requestId: 1, name: 'a.bin', size, mediaType: 'text/plain', data: new ArrayBuffer(bytes) });

        // Act
        send(file(MAX_FILE_BYTES + 1, MAX_FILE_BYTES + 1));
        send(file(5, 4));

        // Assert
        expect(handle.stats().dropped).toMatchObject({ oversized: 1, invalid: 1 });
    });

    it('should ignore a fileResult for an unknown requestId', async () => {
        // Arrange
        const result = transferFile(fileOf('hello'));
        await settle();
        const requestId = posted('file')[0]?.requestId;

        // Act
        send(message('fileResult', { requestId: 999, ok: true, file: { ...reference, id: 'other' } }));
        send(message('fileProgress', { requestId: 999, loaded: 1, total: 5 }));
        send(message('fileResult', { requestId, ok: true, file: reference }));

        // Assert
        await expect(result).resolves.toEqual(reference);
        expect(posted('error')).toHaveLength(0);
    });

    it('should leave file bytes out of the snapshot and ignore results with a wrong nonce', async () => {
        // Arrange
        const result = transferFile(fileOf('hello'));
        await settle();
        const requestId = posted('file')[0]?.requestId;
        const failure = result.catch((error: unknown) => error);

        // Act
        send({ ...message('fileResult', { requestId, ok: true, file: reference }), nonce: 'other' });
        send(message('write', { writes: [{ path: '$.data.x', value: 1 }] }));
        handle.dispose();

        // Assert
        expect(JSON.stringify(posted('snapshot'))).not.toContain('ArrayBuffer');
        expect(handle.stats().dropped.foreign).toBe(1);
        expect(await failure).toMatchObject({ code: 'cancelled' });
    });
});
