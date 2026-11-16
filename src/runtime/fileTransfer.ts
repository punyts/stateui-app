import { FILE_IDLE_TIMEOUT_MS, FILE_RELEASE_TIMEOUT_MS, MAX_FILE_BYTES } from './limits.js';
import type { FileErrorCode, FileProgressMessage, FileReference, FileReleasedMessage, FileResultMessage } from './messages.js';

/** How far a transfer has come, in bytes of the file */
export interface FileProgress {
    loaded: number;
    total: number;
}

/** The second argument of the `transferFile` hook */
export interface TransferFileOptions {
    /** Called for each `fileProgress` the host sends */
    onProgress?(progress: FileProgress): void;
    /** Aborting it posts `fileCancel` and rejects the transfer with `cancelled` */
    signal?: AbortSignal;
}

/**
 * The hook components use to hand a file to the host. It resolves with the reference of the stored file and rejects
 * with a `FileTransferError`
 */
export type TransferFile = (file: File, options?: TransferFileOptions) => Promise<FileReference>;

/**
 * The hook components use to give a stored file back, so a field that saves often does not fill the app's quota. It
 * resolves when the host answered `ok`: the file is gone, was never there (releasing twice is fine), or is kept because
 * the app or its live state still references it. It rejects with a `FileTransferError` (`offline` when the host does
 * not answer within `FILE_RELEASE_TIMEOUT_MS`, `internal`, or the code of the host)
 */
export type ReleaseFile = (id: string) => Promise<void>;

/** What `transferFile` rejects with: `code` is the `fileResult` code, or `offline`, `cancelled`, `too_large` or `internal` raised here */
export class FileTransferError extends Error {
    readonly code: FileErrorCode;

    constructor(code: FileErrorCode, message: string) {
        super(message);
        this.name = 'FileTransferError';
        this.code = code;
    }
}

export interface FileTransferPort {
    /** Posts a `file` with its `data` buffer in the transfer list; false when the message was not sent */
    sendFile(message: { requestId: number; name: string; size: number; mediaType: string; data: ArrayBuffer }): boolean;
    sendCancel(requestId: number): void;
    /** Posts a `fileRelease`; false when the message was not sent */
    sendRelease(requestId: number, id: string): boolean;
}

export interface FileTransfers {
    transferFile: TransferFile;
    /** Routes a `fileProgress`; a request that is not waiting is ignored */
    progress(message: FileProgressMessage): void;
    /** Routes a `fileResult`; a request that is not waiting is ignored */
    result(message: FileResultMessage): void;
    releaseFile: ReleaseFile;
    /** Routes a `fileReleased`; a request that is not waiting is ignored */
    released(message: FileReleasedMessage): void;
    /**
     * Cancels every waiting transfer (posts `fileCancel` and rejects each with `cancelled`) and rejects every waiting
     * release with `cancelled`; the host may still remove the file
     */
    cancelAll(): void;
}

interface Pending {
    options: TransferFileOptions;
    resolve(file: FileReference): void;
    reject(error: FileTransferError): void;
    timer: ReturnType<typeof setTimeout> | undefined;
    abort: (() => void) | undefined;
}

interface PendingRelease {
    resolve(): void;
    reject(error: FileTransferError): void;
    timer: ReturnType<typeof setTimeout>;
}

/** The state of the transfers and releases a runtime has under way. Bytes pass through; nothing is kept in the store */
export function createFileTransfers(port: FileTransferPort): FileTransfers {
    const pending = new Map<number, Pending>();
    const releases = new Map<number, PendingRelease>();
    let lastId = 0;

    function finish(requestId: number): Pending | undefined {
        const entry = pending.get(requestId);
        if (!entry) return undefined;
        pending.delete(requestId);
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        if (entry.abort) entry.options.signal?.removeEventListener('abort', entry.abort);
        return entry;
    }

    function armTimer(requestId: number, entry: Pending): void {
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
            const expired = finish(requestId);
            expired?.reject(new FileTransferError('offline', 'The host did not answer'));
        }, FILE_IDLE_TIMEOUT_MS);
    }

    function cancel(requestId: number): void {
        const entry = finish(requestId);
        if (!entry) return;
        port.sendCancel(requestId);
        entry.reject(new FileTransferError('cancelled', 'The transfer was cancelled'));
    }

    async function transferFile(file: File, options: TransferFileOptions = {}): Promise<FileReference> {
        if (options.signal?.aborted) throw new FileTransferError('cancelled', 'The transfer was cancelled');
        if (file.size > MAX_FILE_BYTES) throw new FileTransferError('too_large', 'The file is larger than the limit');
        const data = await file.arrayBuffer();
        if (options.signal?.aborted) throw new FileTransferError('cancelled', 'The transfer was cancelled');
        lastId += 1;
        const requestId = lastId;
        return new Promise<FileReference>((resolve, reject) => {
            const entry: Pending = { options, resolve, reject, timer: undefined, abort: undefined };
            pending.set(requestId, entry);
            if (options.signal) {
                entry.abort = () => cancel(requestId);
                options.signal.addEventListener('abort', entry.abort, { once: true });
            }
            const sent = port.sendFile({ requestId, name: file.name, size: data.byteLength, mediaType: file.type, data });
            if (!sent) {
                finish(requestId);
                reject(new FileTransferError('internal', 'The file could not be sent'));
                return;
            }
            armTimer(requestId, entry);
        });
    }

    function finishRelease(requestId: number): PendingRelease | undefined {
        const entry = releases.get(requestId);
        if (!entry) return undefined;
        releases.delete(requestId);
        clearTimeout(entry.timer);
        return entry;
    }

    function releaseFile(id: string): Promise<void> {
        lastId += 1;
        const requestId = lastId;
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                finishRelease(requestId)?.reject(new FileTransferError('offline', 'The host did not answer'));
            }, FILE_RELEASE_TIMEOUT_MS);
            releases.set(requestId, { resolve, reject, timer });
            if (!port.sendRelease(requestId, id)) {
                finishRelease(requestId);
                reject(new FileTransferError('internal', 'The release could not be sent'));
            }
        });
    }

    return {
        transferFile,
        releaseFile,
        progress(message): void {
            const entry = pending.get(message.requestId);
            if (!entry) return;
            armTimer(message.requestId, entry);
            entry.options.onProgress?.({ loaded: message.loaded, total: message.total });
        },
        result(message): void {
            const entry = finish(message.requestId);
            if (!entry) return;
            if (message.ok) entry.resolve(message.file);
            else entry.reject(new FileTransferError(message.code, message.message));
        },
        released(message): void {
            const entry = finishRelease(message.requestId);
            if (!entry) return;
            if (message.ok) entry.resolve();
            else entry.reject(new FileTransferError(message.code, message.message));
        },
        cancelAll(): void {
            for (const requestId of [...pending.keys()]) cancel(requestId);
            for (const requestId of [...releases.keys()]) finishRelease(requestId)?.reject(new FileTransferError('cancelled', 'The release was cancelled'));
        }
    };
}
