import type { AppDocument, JsonObject, JsonValue } from '../core/types.js';

/** The protocol version every message carries in `v`. A message with another version is dropped */
export const PROTOCOL_VERSION = 1;

/** Messages the host sends to the runtime */
export const INBOUND_TYPES = ['load', 'write', 'command', 'locale', 'theme', 'ping', 'fileProgress', 'fileResult'] as const;

/** Messages the runtime sends to the host */
export const OUTBOUND_TYPES = ['ready', 'snapshot', 'emit', 'error', 'pong', 'file', 'fileCancel'] as const;

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

/** The state a `load` carries and a `snapshot` returns (`snapshotState`) */
export interface StateSnapshotData {
    data: JsonObject;
    app: JsonObject;
}

/** One path write: a value to set, or `remove: true` to delete the path */
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

/** The reasons a file transfer fails: what `fileResult` carries as `code`, and what `transferFile` rejects with */
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

/** Mounts the application: the document, the state to load over it and the icons it uses beyond the core set */
export interface LoadMessage extends Envelope<'load'> {
    document: AppDocument;
    state?: StateSnapshotData;
    icons?: IconsMap;
}

/** Path writes for `$.data` and `$.app`, with the icons the new revision uses for the first time */
export interface WriteMessage extends Envelope<'write'> {
    writes: PathWrite[];
    icons?: IconsMap;
}

/** A component command from `ui_command`: `target` is the `$.app` state path of a node, `command` a command its component declares */
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

/** Posted after `load` mounted the application */
export type ReadyMessage = Envelope<'ready'>;

/** The state worth saving (`snapshotState`, minus links, `$.runtime`, content and password values) */
export interface SnapshotMessage extends Envelope<'snapshot'>, StateSnapshotData {}

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

export type InboundMessage =
    | LoadMessage
    | WriteMessage
    | CommandMessage
    | LocaleMessage
    | ThemeMessage
    | PingMessage
    | FileProgressMessage
    | FileResultMessage;
export type OutboundMessage =
    | ReadyMessage
    | SnapshotMessage
    | EmitMessage
    | ErrorMessage
    | PongMessage
    | FileMessage
    | FileCancelMessage;
export type RuntimeMessage = InboundMessage | OutboundMessage;
