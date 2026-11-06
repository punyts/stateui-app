import { FileTransferError } from './fileTransfer.js';
import { FILE_CACHE_BYTES, FILE_READ_TIMEOUT_MS } from './limits.js';
import type { FileDataMessage, FileReference } from './messages.js';

/** A stored file as `readFile` gives it: its reference and a copy of its bytes, which the caller may keep or transfer */
export interface FileData {
    file: FileReference;
    data: ArrayBuffer;
}

/** The second argument of the `readFile` hook */
export interface ReadFileOptions {
    /** Aborting it rejects the read with `cancelled`; the host's answer is still kept for the next read */
    signal?: AbortSignal;
}

/**
 * The hook components use to read a file of the app's store through the host. It resolves with the file's reference
 * and bytes and rejects with a `FileTransferError` (`not_found`, `unauthorized`, `offline`, `too_large`, `cancelled`,
 * `internal`)
 */
export type ReadFile = (id: string, options?: ReadFileOptions) => Promise<FileData>;

export interface FileReadPort {
    /** Posts a `fileRead`; false when the message was not sent */
    sendRead(requestId: number, id: string): boolean;
}

export interface FileReadsOptions {
    /** The ids among `ids` that a node still uses; every cached file counts as used when absent */
    usedIds?(ids: readonly string[]): ReadonlySet<string>;
    /** The most bytes the cache keeps; `FILE_CACHE_BYTES` when absent */
    cacheBytes?: number;
    /** How long a read waits for `fileData`; `FILE_READ_TIMEOUT_MS` when absent */
    timeoutMs?: number;
}

export interface FileReads {
    readFile: ReadFile;
    /** Routes a `fileData`; a request that is not waiting is ignored, and an answer for another id rejects with `internal` */
    data(message: FileDataMessage): void;
    /** Drops the cached files no node uses (`usedIds`) */
    release(): void;
    /** The ids of the cached files, least recently read first */
    cached(): string[];
    /** Rejects every waiting read with `cancelled` and empties the cache */
    cancelAll(): void;
}

interface Waiter {
    resolve(data: FileData): void;
    reject(error: FileTransferError): void;
    signal: AbortSignal | undefined;
    abort: (() => void) | undefined;
}

interface Request {
    id: string;
    waiters: Set<Waiter>;
    timer: ReturnType<typeof setTimeout>;
}

/** A copy of the cached bytes, so a caller that transfers or changes its buffer leaves the cache whole */
function copyOf(entry: FileData): FileData {
    return { file: { ...entry.file }, data: entry.data.slice(0) };
}

/**
 * The file reads of a runtime. Reads of the same id share one `fileRead`; the bytes of each answered file are kept by
 * id (case-insensitive, as file ids are UUIDs) up to `cacheBytes`, so a node that draws again does not ask the host
 * again. Past the cap the files no node uses go first, then the least recently read; `release()` drops the files no
 * node uses at any time
 */
export function createFileReads(port: FileReadPort, options: FileReadsOptions = {}): FileReads {
    const cacheBytes = options.cacheBytes ?? FILE_CACHE_BYTES;
    const timeoutMs = options.timeoutMs ?? FILE_READ_TIMEOUT_MS;
    /** By lower-case id, in the order of the last read (a Map keeps insertion order) */
    const cache = new Map<string, FileData>();
    const requests = new Map<number, Request>();
    const byId = new Map<string, number>();
    let total = 0;
    let lastId = 0;

    function drop(key: string): void {
        const entry = cache.get(key);
        if (!entry) return;
        cache.delete(key);
        total -= entry.data.byteLength;
    }

    function unused(): string[] {
        const keys = [...cache.keys()];
        if (!options.usedIds) return [];
        const used = new Set([...options.usedIds(keys)].map((id) => id.toLowerCase()));
        return keys.filter((key) => !used.has(key));
    }

    function store(entry: FileData): void {
        const key = entry.file.id.toLowerCase();
        drop(key);
        const size = entry.data.byteLength;
        if (size > cacheBytes) return;
        if (total + size > cacheBytes) for (const free of unused()) drop(free);
        for (const oldest of cache.keys()) {
            if (total + size <= cacheBytes) break;
            drop(oldest);
        }
        cache.set(key, entry);
        total += size;
    }

    function unwait(waiter: Waiter): void {
        if (waiter.abort) waiter.signal?.removeEventListener('abort', waiter.abort);
    }

    function finish(requestId: number): Request | undefined {
        const request = requests.get(requestId);
        if (!request) return undefined;
        requests.delete(requestId);
        byId.delete(request.id);
        clearTimeout(request.timer);
        for (const waiter of request.waiters) unwait(waiter);
        return request;
    }

    function request(key: string, id: string): Request | undefined {
        const known = byId.get(key);
        if (known !== undefined) return requests.get(known);
        lastId += 1;
        const requestId = lastId;
        const timer = setTimeout(() => {
            const expired = finish(requestId);
            for (const waiter of expired?.waiters ?? []) waiter.reject(new FileTransferError('offline', 'The host did not answer'));
        }, timeoutMs);
        const created: Request = { id: key, waiters: new Set(), timer };
        requests.set(requestId, created);
        byId.set(key, requestId);
        if (!port.sendRead(requestId, id)) {
            finish(requestId);
            return undefined;
        }
        return created;
    }

    function readFile(id: string, readOptions: ReadFileOptions = {}): Promise<FileData> {
        const { signal } = readOptions;
        if (signal?.aborted) return Promise.reject(new FileTransferError('cancelled', 'The read was cancelled'));
        const key = id.toLowerCase();
        const hit = cache.get(key);
        if (hit) {
            // Read again: it moves to the end, the most recently read
            cache.delete(key);
            cache.set(key, hit);
            return Promise.resolve(copyOf(hit));
        }
        const pending = request(key, id);
        if (!pending) return Promise.reject(new FileTransferError('internal', 'The read could not be sent'));
        return new Promise<FileData>((resolve, reject) => {
            const waiter: Waiter = { resolve, reject, signal, abort: undefined };
            if (signal) {
                waiter.abort = () => {
                    pending.waiters.delete(waiter);
                    reject(new FileTransferError('cancelled', 'The read was cancelled'));
                };
                signal.addEventListener('abort', waiter.abort, { once: true });
            }
            pending.waiters.add(waiter);
        });
    }

    return {
        readFile,
        data(message): void {
            const pending = requests.get(message.requestId);
            if (!pending) return;
            finish(message.requestId);
            if (!message.ok) {
                for (const waiter of pending.waiters) waiter.reject(new FileTransferError(message.code, message.message));
                return;
            }
            if (message.file.id.toLowerCase() !== pending.id) {
                for (const waiter of pending.waiters) waiter.reject(new FileTransferError('internal', 'The host answered with another file'));
                return;
            }
            const entry: FileData = { file: { ...message.file }, data: message.data };
            store(entry);
            for (const waiter of pending.waiters) waiter.resolve(copyOf(entry));
        },
        release(): void {
            for (const key of unused()) drop(key);
        },
        cached: () => [...cache.keys()],
        cancelAll(): void {
            for (const requestId of [...requests.keys()]) {
                const cancelled = finish(requestId);
                for (const waiter of cancelled?.waiters ?? []) waiter.reject(new FileTransferError('cancelled', 'The read was cancelled'));
            }
            cache.clear();
            total = 0;
        }
    };
}
