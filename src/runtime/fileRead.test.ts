import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileReads } from './fileRead.js';
import type { FileReadsOptions } from './fileRead.js';
import { FileTransferError } from './fileTransfer.js';
import { FILE_CACHE_BYTES, FILE_READ_TIMEOUT_MS } from './limits.js';
import { INBOUND_TYPES, OUTBOUND_TYPES, PROTOCOL_VERSION } from './messages.js';
import type { FileDataMessage } from './messages.js';

const ID = '0b6e8c1a-3f1e-4a52-9a43-2f4f1c8f2d10';
const OTHER = '7d1f0a52-9c3e-4b1a-8e2f-61a0b3c4d5e6';

function bytes(...values: number[]): ArrayBuffer {
    return new Uint8Array(values).buffer;
}

function answer(requestId: number, id: string, data: ArrayBuffer, type = 'image/png'): FileDataMessage {
    return { v: PROTOCOL_VERSION, nonce: 'n', type: 'fileData', requestId, ok: true, file: { id, name: 'a.png', size: data.byteLength, type }, data };
}

function failure(requestId: number, code: 'not_found' | 'unauthorized' | 'too_large'): FileDataMessage {
    return { v: PROTOCOL_VERSION, nonce: 'n', type: 'fileData', requestId, ok: false, code, message: 'No' };
}

function setup(options: FileReadsOptions = {}) {
    const sent: { requestId: number; id: string }[] = [];
    const sendRead = vi.fn((requestId: number, id: string) => {
        sent.push({ requestId, id });
        return true;
    });
    const reads = createFileReads({ sendRead }, options);
    return { reads, sent, sendRead };
}

describe('file reads', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('should list fileData as inbound and fileRead as outbound and keep the 50 MiB cache cap', () => {
        expect(INBOUND_TYPES).toContain('fileData');
        expect(OUTBOUND_TYPES).toContain('fileRead');
        expect(FILE_CACHE_BYTES).toBe(50 * 1024 * 1024);
    });

    it('should post one fileRead and resolve with the reference and the bytes of its fileData', async () => {
        // Arrange
        const { reads, sent } = setup();

        // Act
        const result = reads.readFile(ID);
        reads.data(answer(sent[0]?.requestId ?? 0, ID, bytes(1, 2, 3)));

        // Assert
        const read = await result;
        expect(sent).toEqual([{ requestId: 1, id: ID }]);
        expect(read.file).toEqual({ id: ID, name: 'a.png', size: 3, type: 'image/png' });
        expect([...new Uint8Array(read.data)]).toEqual([1, 2, 3]);
    });

    it('should share one fileRead between reads of the same id and answer a later read from the cache', async () => {
        // Arrange
        const { reads, sent } = setup();
        const first = reads.readFile(ID);
        const second = reads.readFile(ID.toUpperCase());

        // Act
        reads.data(answer(1, ID, bytes(7)));
        const third = await reads.readFile(ID);

        // Assert
        expect(sent).toHaveLength(1);
        expect([...new Uint8Array((await first).data)]).toEqual([7]);
        expect([...new Uint8Array((await second).data)]).toEqual([7]);
        expect([...new Uint8Array(third.data)]).toEqual([7]);
        expect(reads.cached()).toEqual([ID]);
    });

    it('should give each read its own copy, so a transferred or changed buffer leaves the cache whole', async () => {
        // Arrange
        const { reads } = setup();
        const first = reads.readFile(ID);
        reads.data(answer(1, ID, bytes(5, 6)));
        const read = await first;

        // Act
        new Uint8Array(read.data)[0] = 9;
        structuredClone(read.data, { transfer: [read.data] });
        const again = await reads.readFile(ID);

        // Assert
        expect(read.data.byteLength).toBe(0);
        expect([...new Uint8Array(again.data)]).toEqual([5, 6]);
    });

    it.each(['not_found', 'unauthorized', 'too_large'] as const)('should reject with the code %s of a failed fileData and keep nothing', async (code) => {
        // Arrange
        const { reads } = setup();
        const result = reads.readFile(ID).catch((error: unknown) => error);

        // Act
        reads.data(failure(1, code));

        // Assert
        const error = await result;
        expect(error).toBeInstanceOf(FileTransferError);
        expect(error).toMatchObject({ code, message: 'No' });
        expect(reads.cached()).toEqual([]);
    });

    it('should reject with internal when the host answers with another file, and ignore an unknown requestId', async () => {
        // Arrange
        const { reads } = setup();
        const result = reads.readFile(ID).catch((error: unknown) => error);

        // Act
        reads.data(answer(99, ID, bytes(1)));
        reads.data(answer(1, OTHER, bytes(1)));

        // Assert
        expect(await result).toMatchObject({ code: 'internal' });
        expect(reads.cached()).toEqual([]);
    });

    it('should reject with offline when no fileData arrives in time', async () => {
        // Arrange
        vi.useFakeTimers();
        const { reads } = setup();
        const result = reads.readFile(ID).catch((error: unknown) => error);

        // Act
        await vi.advanceTimersByTimeAsync(FILE_READ_TIMEOUT_MS);

        // Assert
        expect(await result).toMatchObject({ code: 'offline' });
    });

    it('should reject with cancelled when the signal aborts, keep the other waiter and cache the late answer', async () => {
        // Arrange
        const { reads, sent } = setup();
        const controller = new AbortController();
        const cancelled = reads.readFile(ID, { signal: controller.signal }).catch((error: unknown) => error);
        const kept = reads.readFile(ID);

        // Act
        controller.abort();
        reads.data(answer(1, ID, bytes(4)));

        // Assert
        expect(await cancelled).toMatchObject({ code: 'cancelled' });
        expect([...new Uint8Array((await kept).data)]).toEqual([4]);
        expect(sent).toHaveLength(1);
        expect(reads.cached()).toEqual([ID]);
    });

    it('should reject an aborted read at once and post nothing, and reject with internal when the read cannot be sent', async () => {
        // Arrange
        const controller = new AbortController();
        controller.abort();
        const { reads, sent } = setup();
        const refused = createFileReads({ sendRead: () => false });

        // Act
        const aborted = await reads.readFile(ID, { signal: controller.signal }).catch((error: unknown) => error);
        const unsent = await refused.readFile(ID).catch((error: unknown) => error);

        // Assert
        expect(aborted).toMatchObject({ code: 'cancelled' });
        expect(sent).toHaveLength(0);
        expect(unsent).toMatchObject({ code: 'internal' });
    });

    it('should release the cached files no node uses', async () => {
        // Arrange
        let used = new Set([ID, OTHER]);
        const { reads } = setup({ usedIds: (ids) => new Set(ids.filter((id) => used.has(id))) });
        const first = reads.readFile(ID);
        const second = reads.readFile(OTHER);
        reads.data(answer(1, ID, bytes(1)));
        reads.data(answer(2, OTHER, bytes(2)));
        await Promise.all([first, second]);

        // Act
        reads.release();
        const before = reads.cached();
        used = new Set([OTHER]);
        reads.release();

        // Assert
        expect(before).toEqual([ID, OTHER]);
        expect(reads.cached()).toEqual([OTHER]);
    });

    it('should keep the cache under its cap: the files no node uses go first, then the least recently read', async () => {
        // Arrange
        const ids = ['a', 'b', 'c', 'd'].map((letter) => `${letter.repeat(8)}-0000-4000-8000-000000000000`);
        const used = new Set([ids[0], ids[1], ids[3]]);
        const { reads, sent } = setup({ cacheBytes: 3, usedIds: (list) => new Set(list.filter((id) => used.has(id))) });
        const readOne = async (index: number) => {
            const result = reads.readFile(ids[index] ?? '');
            const last = sent[sent.length - 1];
            if (last && last.id === ids[index]) reads.data(answer(last.requestId, ids[index] ?? '', bytes(index)));
            return result;
        };
        await readOne(0);
        await readOne(1);
        await readOne(2);

        // Act
        await readOne(0);
        await readOne(3);
        const afterUnused = reads.cached();
        used.add(ids[2] ?? '');
        await readOne(2);

        // Assert
        expect(afterUnused).toEqual([ids[1], ids[0], ids[3]]);
        expect(reads.cached()).toEqual([ids[0], ids[3], ids[2]]);
    });

    it('should not keep a file larger than the whole cache, and cancelAll should reject waiting reads and empty the cache', async () => {
        // Arrange
        const { reads } = setup({ cacheBytes: 1 });
        const big = reads.readFile(ID);
        reads.data(answer(1, ID, bytes(1, 2)));
        await big;
        const small = reads.readFile(OTHER);
        reads.data(answer(2, OTHER, bytes(1)));
        await small;
        const waiting = reads.readFile(ID).catch((error: unknown) => error);

        // Act
        const before = reads.cached();
        reads.cancelAll();

        // Assert
        expect(before).toEqual([OTHER]);
        expect(await waiting).toMatchObject({ code: 'cancelled' });
        expect(reads.cached()).toEqual([]);
    });
});
