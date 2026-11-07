import type { Store } from '@punyts/state';
import type { BuildError } from '../../core/errors/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import type { JsonValue } from '../../core/types.js';
import type { FileData, ReadFile } from '../../runtime/fileRead.js';
import type { Load3d, Scene3dChunk } from '../../runtime/load3d.js';
import type { FileProgress, ReleaseFile, TransferFile } from '../../runtime/fileTransfer.js';
import type { FileReference } from '../../runtime/messages.js';

/** The event a component raises to hand a file to the host's `transferFile` hook; a controller cannot reach the hooks, so the dispatcher answers it. Bubbles and is composed */
export const FILE_TRANSFER_EVENT = 'ui-file-transfer';

/**
 * The `detail` of `ui-file-transfer`. The dispatcher calls `respond` once, synchronously, with the promise
 * `hooks.transferFile` returns, and stops the event. When the host gives no hook `respond` is never called, so a component
 * treats an event that comes back unanswered as a transfer that cannot be made
 */
export interface FileTransferRequest {
    readonly file: File;
    /** Called for each progress report of the host */
    readonly onProgress?: (progress: FileProgress) => void;
    /** Aborting it cancels the transfer */
    readonly signal?: AbortSignal;
    respond(result: Promise<FileReference>): void;
}

/** The event a component raises to read a stored file through the host's `readFile` hook. Bubbles and is composed */
export const FILE_READ_EVENT = 'ui-file-read';

/**
 * The `detail` of `ui-file-read`. The dispatcher calls `respond` once, synchronously, with the promise `hooks.readFile`
 * returns, and stops the event. When the host gives no hook `respond` is never called, so a component treats an event
 * that comes back unanswered as the `offline` failure of the read
 */
export interface FileReadRequest {
    /** The id of the file's reference */
    readonly id: string;
    /** Aborting it cancels the read */
    readonly signal?: AbortSignal;
    respond(result: Promise<FileData>): void;
}

/** The event a component raises to give a stored file back through the host's `releaseFile` hook. Bubbles and is composed */
export const FILE_RELEASE_EVENT = 'ui-file-release';

/**
 * The `detail` of `ui-file-release`. The dispatcher calls `respond` once, synchronously, with the promise
 * `hooks.releaseFile` returns, and stops the event. When the host gives no hook `respond` is never called, so a component
 * treats an event that comes back unanswered as a release that cannot be made (the host's sweep removes the file once
 * nothing references it)
 */
export interface FileReleaseRequest {
    /** The id of the file's reference */
    readonly id: string;
    respond(result: Promise<void>): void;
}

/** The event a `scene3d` raises to get the 3D renderer chunk through the host's `load3d` hook (G3.3). Bubbles and is composed */
export const LOAD_3D_EVENT = 'ui-load-3d';

/**
 * The `detail` of `ui-load-3d`. The dispatcher calls `respond` once, synchronously, with the promise `hooks.load3d`
 * returns (it resolves with `globalThis.__stateui3d` and rejects with a `Load3dError`), and stops the event. When the
 * host gives no hook (no chunk is served) `respond` is never called, so the scene treats an event that comes back
 * unanswered as a renderer it cannot load and shows its `_fallback`
 */
export interface Load3dRequest {
    respond(result: Promise<Scene3dChunk>): void;
}

/**
 * What a root component's `commands` object holds for one command: `value` is the command object's `value`
 * (absent when it has none; `$row` and `$row.path` are already read from the record), `payload` is the `detail`
 * of the event that started the list, and `row` is the store path of the record when the command was aimed at
 * `$row` from a row template. It throws to fail,
 * which stops the rest of the list; it is synchronous
 */
export type CommandHandler = (value: JsonValue | undefined, payload: unknown, row?: string) => void;

/**
 * The command interface of a root component: the element carries a `commands` object with one function per command
 * its shape declares in `commands`. A controller sets it when it runs and removes it in `dispose`
 */
export interface CommandElement extends Element {
    commands?: Readonly<Record<string, CommandHandler>>;
}

/** What the host application hands to the dispatcher */
export interface DispatchHooks {
    /** Called by the system command `emit` with the event name (the command's `target`) and its payload */
    onEmit?(name: string, payload: unknown): void;
    /**
     * Hands a file to the host and resolves with the reference of the stored file (E8.39). Set by the runtime inside
     * the preview frame; absent when the app is mounted without a host that takes files
     */
    transferFile?: TransferFile;
    /**
     * Reads a stored file through the host and resolves with its reference and bytes (G1.9). Set by the runtime inside
     * the preview frame; absent when the app is mounted without a host that reads files
     */
    readFile?: ReadFile;
    /**
     * Gives a stored file back to the host (G2.5). Set by the runtime inside the preview frame; absent when the app is
     * mounted without a host that takes files
     */
    releaseFile?: ReleaseFile;
    /**
     * Loads the 3D renderer chunk and resolves with `globalThis.__stateui3d` (G3.3). Set by the runtime inside the
     * preview frame when the host named a `3d` chunk in `load`; absent otherwise
     */
    load3d?: Load3d;
    /** Called with every `SUI-RUN` error the dispatcher reports, after it is reported through `@punyts/core` */
    onError?(error: BuildError): void;
}

export interface DispatcherOptions {
    /** The element the store is mounted on; the dispatcher listens here for events raised by the nodes below it */
    host: Element;
    store: Store<unknown>;
    library: ComponentLibrary;
    /** `ResolveResult.instances`: where composed components were expanded, for `^name` targets; empty when absent */
    instances?: Readonly<Record<string, string[]>>;
    /** The state path of the root node; `$.app` when absent */
    rootPath?: string;
    /** More roots whose nodes raise events, such as the screens (`$.screens.home`); app events still run on `rootPath` */
    roots?: readonly string[];
    hooks?: DispatchHooks;
    /** Runs the `navigate` command: moves `$.route` to a screen, or returns why it cannot. Absent in an app without screens */
    navigate?(screen: string, params: JsonValue | undefined): string | undefined;
}

export interface Dispatcher {
    /** Runs the root node's `on` entry for an app event (`sync.rejected`) with the payload */
    raise(name: string, payload?: unknown): void;
    /** Removes every listener; later events do nothing. Safe to call more than once */
    dispose(): void;
}
