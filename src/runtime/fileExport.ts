import { FILE_EXPORT_TIMEOUT_MS } from './limits.js';
import { FileTransferError } from './fileTransfer.js';
import type { JsonObject } from '../core/types.js';
import type { FileExportedMessage } from './messages.js';

/** What a component asks to export: the resolved state path of its records, the file name and the export request (`RecordExportRequest`) */
export interface FileExportSpec {
    source: string;
    name: string;
    request: JsonObject;
}

/**
 * The hook components use to have their records exported as a file the user saves. It resolves with the number of rows
 * written once the host handed the file to the browser, and rejects with a `FileTransferError` (`offline` when the host
 * does not answer within `FILE_EXPORT_TIMEOUT_MS`, `internal` when the message could not be sent, or the host's code)
 */
export type ExportFile = (spec: FileExportSpec) => Promise<number>;

export interface FileExportPort {
    /** Posts a `fileExport`; false when the message was not sent (it failed validation) */
    sendExport(message: { requestId: number } & FileExportSpec): boolean;
}

export interface FileExports {
    exportFile: ExportFile;
    /** Routes a `fileExported`; a request that is not waiting is ignored */
    exported(message: FileExportedMessage): void;
    /** Rejects every waiting export with `cancelled` */
    cancelAll(): void;
}

interface PendingExport {
    resolve(rows: number): void;
    reject(error: FileTransferError): void;
    timer: ReturnType<typeof setTimeout>;
}

/** The exports a runtime has under way. No row passes through the runtime: the host fetches the file from the authority */
export function createFileExports(port: FileExportPort): FileExports {
    const pending = new Map<number, PendingExport>();
    let lastId = 0;

    function finish(requestId: number): PendingExport | undefined {
        const entry = pending.get(requestId);
        if (!entry) return undefined;
        pending.delete(requestId);
        clearTimeout(entry.timer);
        return entry;
    }

    return {
        exportFile(spec): Promise<number> {
            lastId += 1;
            const requestId = lastId;
            return new Promise<number>((resolve, reject) => {
                const timer = setTimeout(() => finish(requestId)?.reject(new FileTransferError('offline', 'The host did not answer')), FILE_EXPORT_TIMEOUT_MS);
                pending.set(requestId, { resolve, reject, timer });
                if (!port.sendExport({ requestId, ...spec })) {
                    finish(requestId);
                    reject(new FileTransferError('internal', 'The export could not be sent'));
                }
            });
        },
        exported(message): void {
            const entry = finish(message.requestId);
            if (!entry) return;
            if (message.ok) entry.resolve(message.rows);
            else entry.reject(new FileTransferError(message.code, message.message));
        },
        cancelAll(): void {
            for (const requestId of [...pending.keys()]) finish(requestId)?.reject(new FileTransferError('cancelled', 'The export was cancelled'));
        }
    };
}
