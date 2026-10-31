import type { AppDocument, JsonObject, JsonValue } from '../core/types.js';

/** The protocol version every message carries in `v`. A message with another version is dropped */
export const PROTOCOL_VERSION = 1;

/** Messages the host sends to the runtime */
export const INBOUND_TYPES = ['load', 'write', 'command', 'locale', 'theme', 'ping'] as const;

/** Messages the runtime sends to the host */
export const OUTBOUND_TYPES = ['ready', 'snapshot', 'emit', 'error', 'pong'] as const;

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

export type InboundMessage = LoadMessage | WriteMessage | CommandMessage | LocaleMessage | ThemeMessage | PingMessage;
export type OutboundMessage = ReadyMessage | SnapshotMessage | EmitMessage | ErrorMessage | PongMessage;
export type RuntimeMessage = InboundMessage | OutboundMessage;
