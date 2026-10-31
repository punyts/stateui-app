import { FILE_IDLE_TIMEOUT_MS, MAX_FILE_BYTES } from './limits.js';
import type { FileErrorCode, FileProgressMessage, FileReference, FileResultMessage } from './messages.js';

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
}

export interface FileTransfers {
    transferFile: TransferFile;
    /** Routes a `fileProgress`; a request that is not waiting is ignored */
    progress(message: FileProgressMessage): void;
    /** Routes a `fileResult`; a request that is not waiting is ignored */
    result(message: FileResultMessage): void;
    /** Cancels every waiting transfer: posts `fileCancel` and rejects each with `cancelled` */
    cancelAll(): void;
}

interface Pending {
    options: TransferFileOptions;
    resolve(file: FileReference): void;
    reject(error: FileTransferError): void;
    timer: ReturnType<typeof setTimeout> | undefined;
    abort: (() => void) | undefined;
}

/** The state of the transfers a runtime has under way. Bytes pass through; nothing is kept in the store */
export function createFileTransfers(port: FileTransferPort): FileTransfers {
    const pending = new Map<number, Pending>();
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

    return {
        transferFile,
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
        cancelAll(): void {
            for (const requestId of [...pending.keys()]) cancel(requestId);
        }
    };
}
