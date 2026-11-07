import type { AppInstance } from '../core/snapshot/index.js';
import type { AppDocument, AppEventName, JsonObject, JsonValue } from '../core/types.js';

export { APP_EVENTS } from '../core/types.js';
export type { AppEventName } from '../core/types.js';

/** The protocol version every message carries in `v`. A message with another version is dropped */
export const PROTOCOL_VERSION = 1;

/** Messages the host sends to the runtime */
export const INBOUND_TYPES = ['load', 'write', 'command', 'locale', 'theme', 'event', 'ping', 'fileProgress', 'fileResult', 'fileData', 'fileReleased'] as const;

/** Messages the runtime sends to the host */
export const OUTBOUND_TYPES = ['ready', 'change', 'emit', 'error', 'pong', 'file', 'fileCancel', 'fileRead', 'fileRelease'] as const;

/** The whole closed set of message types */
export const MESSAGE_TYPES = [...INBOUND_TYPES, ...OUTBOUND_TYPES] as const;

export type InboundType = (typeof INBOUND_TYPES)[number];
export type OutboundType = (typeof OUTBOUND_TYPES)[number];
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** One path of an icon: path data, or the styled form the icon component accepts */
export type IconPathData = string | { d: string; fill?: true; stroke?: false; opacity?: number };

/** What `$.runtime.icons` holds for one icon, as the icon component reads it */
export interface IconData {
    outline: IconPathData[];
    filled?: IconPathData[];
}

/** Icon name to path data */
export type IconsMap = Record<string, IconData>;

/** The state a `load` carries over the document: the data and the node state (`snapshotState`) */
export interface StateSnapshotData {
    data: JsonObject;
    app: JsonObject;
}

/** One path write: a value to set, or `remove: true` to delete the path. The runtime applies it as a sync write, so it posts no `change` */
export interface PathWrite {
    path: string;
    value?: JsonValue;
    remove?: true;
}

/** A runtime error as it travels: the plain fields of a `BuildError` */
export interface ProtocolError {
    code: string;
    message: string;
    severity?: 'error' | 'warning';
    statePath?: string;
    component?: string;
}

/**
 * The reasons a file transfer, read or release fails: what `fileResult`, `fileData` and `fileReleased` carry as
 * `code`, and what `transferFile`, `readFile` and `releaseFile` reject with
 */
export const FILE_ERROR_CODES = [
    'too_large',
    'unsupported_type',
    'quota',
    'not_found',
    'unauthorized',
    'offline',
    'cancelled',
    'internal'
] as const;

export type FileErrorCode = (typeof FILE_ERROR_CODES)[number];

/** What a component keeps of an uploaded file: a reference, never the bytes */
export interface FileReference {
    id: string;
    name: string;
    size: number;
    type: string;
}

interface Envelope<T extends MessageType> {
    /** The protocol version, `PROTOCOL_VERSION` */
    v: typeof PROTOCOL_VERSION;
    /** The per-load nonce the host made; both sides drop messages without it */
    nonce: string;
    type: T;
}

/** How an app keeps its state; the same names as `AppMode` of the validator */
export type RuntimeMode = 'standalone' | 'persisted' | 'full';

/** The operations of a change, as `@punyts/state-sync` names them */
export const CHANGE_OPS = ['set', 'replace', 'merge', 'delete'] as const;

export type ChangeOp = (typeof CHANGE_OPS)[number];

/** A change the user (or a controller) made in the runtime's store, without the base revision the host's sync client adds */
export interface RuntimeChange {
    id: string;
    path: string;
    op: ChangeOp;
    /** Absent for `delete` */
    value?: JsonValue;
}

/**
 * The scripts beside the runtime page that the runtime may load on demand, each named by its content hash: `3d` is
 * the renderer of `@punyts/stateui-3d`, loaded by the first `scene3d` that mounts (`load3d`)
 */
export interface RuntimeChunks {
    '3d'?: string;
}

/**
 * Mounts the application: the document, the state to load over it, the icons it uses beyond the core set and the
 * mode (`standalone` when absent). `instance` is a persona's instance, laid over the definition as `mountApp` lays
 * `MountOptions.instance` (the shell, the screens, the data and the route), and `chunks` names the chunk scripts the
 * host serves beside the runtime page
 */
export interface LoadMessage extends Envelope<'load'> {
    document: AppDocument;
    mode?: RuntimeMode;
    state?: StateSnapshotData;
    instance?: AppInstance;
    icons?: IconsMap;
    /** The chunk scripts the host serves (`RuntimeChunks`); without `3d` a scene shows its `_fallback` */
    chunks?: RuntimeChunks;
}

/** Path writes for `$.data` and `$.app`, with the icons the new revision uses for the first time */
export interface WriteMessage extends Envelope<'write'> {
    writes: PathWrite[];
    icons?: IconsMap;
}

/**
 * A command from `ui_command`: `target` is the state path of a node (`$.app...` or `$.screens.{name}...`) and `command` a
 * command its component declares, or `navigate` with a screen name as `target` and the params as `value`
 */
export interface CommandMessage extends Envelope<'command'> {
    target: string;
    command: string;
    value?: JsonValue;
}

/** Switch the language to a code the document or the library has an overlay for */
export interface LocaleMessage extends Envelope<'locale'> {
    locale: string;
}

/** Apply the theme overlay `name` of `kind` (`mode`, `brand` or `motion`) */
export interface ThemeMessage extends Envelope<'theme'> {
    kind: string;
    name: string;
}

export interface PingMessage extends Envelope<'ping'> {
    id: number;
}

export interface PongMessage extends Envelope<'pong'> {
    id: number;
}

/** Raises an app event: `sync.rejected` with the rejected path and the reason as its payload */
export interface EventMessage extends Envelope<'event'> {
    name: AppEventName;
    payload?: JsonValue;
}

/** Posted after `load` mounted the application */
export type ReadyMessage = Envelope<'ready'>;

/** One change of the store, posted as it is captured (never for a host write, `$.runtime` or a password value) */
export interface ChangeMessage extends Envelope<'change'> {
    change: RuntimeChange;
}

/** The `emit` command of an `on` entry: an event name and its payload */
export interface EmitMessage extends Envelope<'emit'> {
    name: string;
    payload?: JsonValue;
}

export interface ErrorMessage extends Envelope<'error'> {
    errors: ProtocolError[];
}

/**
 * A file the user gave a component, for the host to upload. `requestId` is a positive integer the runtime makes;
 * `data` is an `ArrayBuffer` of `size` bytes that travels in the transfer list (moved, not copied)
 */
export interface FileMessage extends Envelope<'file'> {
    requestId: number;
    name: string;
    size: number;
    /** The media type of the file. Not `type`: that is the message type of the envelope */
    mediaType: string;
    data: ArrayBuffer;
}

/** The user removed the file, or the component went away: the host aborts the upload */
export interface FileCancelMessage extends Envelope<'fileCancel'> {
    requestId: number;
}

/** How many bytes of the file the host has uploaded so far */
export interface FileProgressMessage extends Envelope<'fileProgress'> {
    requestId: number;
    loaded: number;
    total: number;
}

/** The end of a transfer: the reference of the stored file, or the reason it failed */
export type FileResultMessage = Envelope<'fileResult'> &
    (
        | { requestId: number; ok: true; file: FileReference }
        | { requestId: number; ok: false; code: FileErrorCode; message: string }
    );

/**
 * A component asks for the bytes of a stored file (`readFile`). `requestId` is a positive integer the runtime makes;
 * `id` is the file's id from its reference. The host answers with `fileData`
 */
export interface FileReadMessage extends Envelope<'fileRead'> {
    requestId: number;
    id: string;
}

/**
 * The answer to `fileRead`: the reference of the stored file and its bytes (`data`, an `ArrayBuffer` of `file.size`
 * bytes that travels in the transfer list), or the reason it could not be read
 */
export type FileDataMessage = Envelope<'fileData'> &
    (
        | { requestId: number; ok: true; file: FileReference; data: ArrayBuffer }
        | { requestId: number; ok: false; code: FileErrorCode; message: string }
    );

/**
 * A component gives a stored file back (`releaseFile`), so a field that saves often does not fill the app's quota.
 * `requestId` is a positive integer the runtime makes; `id` is the file's id from its reference. The host answers with
 * `fileReleased`
 */
export interface FileReleaseMessage extends Envelope<'fileRelease'> {
    requestId: number;
    id: string;
}

/**
 * The answer to `fileRelease`: `ok: true` when the file is gone, was never there, or is kept by the host because the
 * app or its live state still references it (the host's sweep removes it once nothing does); otherwise the reason. Not
 * `fileResult`, whose `ok: true` form carries a file reference
 */
export type FileReleasedMessage = Envelope<'fileReleased'> &
    ({ requestId: number; ok: true } | { requestId: number; ok: false; code: FileErrorCode; message: string });

export type InboundMessage =
    | LoadMessage
    | WriteMessage
    | CommandMessage
    | LocaleMessage
    | ThemeMessage
    | EventMessage
    | PingMessage
    | FileProgressMessage
    | FileResultMessage
    | FileDataMessage
    | FileReleasedMessage;
export type OutboundMessage =
    | ReadyMessage
    | ChangeMessage
    | EmitMessage
    | ErrorMessage
    | PongMessage
    | FileMessage
    | FileCancelMessage
    | FileReadMessage
    | FileReleaseMessage;
export type RuntimeMessage = InboundMessage | OutboundMessage;
