import { isIconsMap } from './icons.js';
import { isFilesSource, isGrant } from './fileUrl.js';
import {
    CHUNK_HASH_PATTERN,
    CHUNK_NAMES,
    MAX_CHANGE_ID_LENGTH,
    MAX_ERROR_TEXT,
    MAX_ERRORS,
    MAX_FILE_BYTES,
    MAX_FILE_ID_LENGTH,
    MAX_FILE_NAME_LENGTH,
    MAX_FILE_TYPE_LENGTH,
    MAX_INSPECT_CHILDREN,
    MAX_INSPECT_NODES,
    MAX_NAME_LENGTH,
    MAX_NONCE_LENGTH,
    MAX_PATH_LENGTH,
    MAX_WRITES,
    MESSAGE_BYTE_LIMITS
} from './limits.js';
import { CHANGE_OPS, FILE_ERROR_CODES, MAX_FLOATING, MESSAGE_TYPES, PROTOCOL_VERSION } from './messages.js';
import { isAppEvent } from '../core/types.js';
import { isLanguageCode } from '../core/locale/languageCode.js';
import { MAX_REQUEST_ID, MAX_REQUEST_NOTE } from '../core/on/types.js';
import { EXPORT_NAME_PATTERN, EXPORT_SOURCE_PATTERN, readExportRequest } from '../core/records/index.js';
import type { MessageType, RuntimeMessage } from './messages.js';

/** Why a message was dropped */
export type DropReason = 'invalid' | 'unknown' | 'oversized';

export type ValidationResult = { ok: true; message: RuntimeMessage } | { ok: false; reason: DropReason };

const encoder = new TextEncoder();
/**
 * The synced branches, which changes and writes reach; `$.route` is protected, so a write to it is refused by the
 * store. `$.raised` holds the events the nodes raised (`dom/on/raised.ts`)
 */
const SYNC_PATH = /^\$\.(data|app|screens|route|theme|locale|raised)(\.[^.\s]+)*$/;
/** The sync status the host writes */
const STATUS_PATH = /^\$\.runtime\.(sync|requests)(\.[^.\s]+)*$/;
const MODES = ['standalone', 'persisted', 'full'];
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const NAME = /^[A-Za-z][A-Za-z0-9_.:-]*$/;
/** A node's `@id` */
const NODE_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;
/**
 * A key chord: modifiers in the order mod, shift, alt, then a letter, a digit, `-`, `=` or `escape`. A chord with no
 * `mod` (a bare key such as `v`, or `shift+s`) goes to the host only while the person is not typing
 */
export const KEY_CHORD = /^(mod\+)?(shift\+)?(alt\+)?([a-z0-9=-]|escape)$/;
/** The most theme kinds a `load` names in `active` */
const MAX_ACTIVE = 8;

/** The most key chords a `load` names */
export const MAX_KEYS = 16;

function isKeyChord(value: unknown): value is string {
    return typeof value === 'string' && KEY_CHORD.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown, max: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/** True for a value `JSON.stringify` keeps as it is: no functions, symbols, `undefined`, non-finite numbers or cycles */
function isJson(value: unknown, depth = 0): boolean {
    if (depth > 64) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every((item) => isJson(item, depth + 1));
    if (isRecord(value)) return Object.values(value).every((item) => isJson(item, depth + 1));
    return false;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return isRecord(value) && isJson(value);
}

function isStateSnapshot(message: Record<string, unknown>): boolean {
    return isJsonObject(message['data']) && isJsonObject(message['app']);
}

/** An `AppInstance`: `app` and `screens` objects, and optionally a route with a screen name, data and active overlay names */
function isInstance(value: unknown): boolean {
    if (!isJsonObject(value) || !hasOnlyKeys(value, ['app', 'screens', 'route', 'theme', 'data'])) return false;
    if (!isRecord(value['app']) || !isRecord(value['screens'])) return false;
    const route = value['route'];
    if (route !== undefined && !(isRecord(route) && hasOnlyKeys(route, ['screen', 'params']) && isText(route['screen'], MAX_NAME_LENGTH))) return false;
    const theme = value['theme'];
    if (theme !== undefined && !(isRecord(theme) && hasOnlyKeys(theme, ['active']) && (theme['active'] === undefined || isRecord(theme['active'])))) return false;
    return value['data'] === undefined || isRecord(value['data']);
}

/** The `chunks` of a `load`: an object of known chunk names (`CHUNK_NAMES`), each a hash of 16 lower-case hex characters */
function isChunks(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return Object.entries(value).every(([name, hash]) => (CHUNK_NAMES as readonly string[]).includes(name) && typeof hash === 'string' && CHUNK_HASH_PATTERN.test(hash));
}

function isSafePath(path: unknown, pattern: RegExp): path is string {
    if (typeof path !== 'string' || path.length > MAX_PATH_LENGTH || !pattern.test(path)) return false;
    return path.split('.').every((segment) => !FORBIDDEN_SEGMENTS.has(segment));
}

/**
 * True when `path` is a state path a write may reach: a synced branch (`$.data`, `$.app`, `$.screens`, `$.route`,
 * `$.theme`, `$.locale`), the sync status (`$.runtime.sync`) or the requests the host knows (`$.runtime.requests`)
 */
export function isWritablePath(path: unknown): path is string {
    return isSafePath(path, SYNC_PATH) || isSafePath(path, STATUS_PATH);
}

/** A change of a synced branch: a writer-made id, the path, the op and a value unless it deletes */
function isRuntimeChange(value: unknown): boolean {
    if (!isRecord(value) || !Object.keys(value).every((key) => ['id', 'path', 'op', 'value'].includes(key))) return false;
    if (!isText(value['id'], MAX_CHANGE_ID_LENGTH) || !isSafePath(value['path'], SYNC_PATH)) return false;
    if (typeof value['op'] !== 'string' || !(CHANGE_OPS as readonly string[]).includes(value['op'])) return false;
    return value['op'] === 'delete' ? value['value'] === undefined : 'value' in value && isJson(value['value']);
}

/** A node's state named by the node's id: `#save.hidden`, `#orders.filter.status` */
const NODE_WRITE = /^#[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;

function isPathWrite(value: unknown): boolean {
    if (!isRecord(value) || !(isWritablePath(value['path']) || isSafePath(value['path'], NODE_WRITE))) return false;
    if (!Object.keys(value).every((key) => key === 'path' || key === 'value' || key === 'remove' || key === 'optional')) return false;
    if (value['optional'] !== undefined && value['optional'] !== true) return false;
    if (value['remove'] !== undefined) return value['remove'] === true && value['value'] === undefined;
    return 'value' in value && isJson(value['value']);
}

function isProtocolError(value: unknown): boolean {
    if (!isRecord(value) || !isText(value['code'], MAX_NAME_LENGTH) || !isText(value['message'], MAX_ERROR_TEXT)) return false;
    if (value['severity'] !== undefined && value['severity'] !== 'error' && value['severity'] !== 'warning') return false;
    for (const key of ['statePath', 'component']) {
        if (value[key] !== undefined && !isText(value[key], MAX_ERROR_TEXT)) return false;
    }
    return Object.keys(value).every((key) => ['code', 'message', 'severity', 'statePath', 'component'].includes(key));
}

function hasOnlyKeys(message: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(message).every((key) => key === 'v' || key === 'nonce' || key === 'type' || keys.includes(key));
}

function isInteger(value: unknown): boolean {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
    return isInteger(value) && (value as number) > 0;
}

/** True for an `ArrayBuffer` of any realm (a buffer cloned from the iframe is not `instanceof` the host's constructor) */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
    return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function isFileReference(value: unknown): boolean {
    return (
        isRecord(value) &&
        Object.keys(value).every((key) => ['id', 'name', 'size', 'type'].includes(key)) &&
        isText(value['id'], MAX_FILE_ID_LENGTH) &&
        isText(value['name'], MAX_FILE_NAME_LENGTH) &&
        isInteger(value['size']) &&
        (value['size'] as number) <= MAX_FILE_BYTES &&
        typeof value['type'] === 'string' &&
        value['type'].length <= MAX_FILE_TYPE_LENGTH
    );
}

function isFileResult(m: Record<string, unknown>): boolean {
    if (!isPositiveInteger(m['requestId'])) return false;
    if (m['ok'] === true) return hasOnlyKeys(m, ['requestId', 'ok', 'file']) && isFileReference(m['file']);
    return (
        m['ok'] === false &&
        hasOnlyKeys(m, ['requestId', 'ok', 'code', 'message']) &&
        typeof m['code'] === 'string' &&
        (FILE_ERROR_CODES as readonly string[]).includes(m['code']) &&
        isText(m['message'], MAX_ERROR_TEXT)
    );
}

/** A `fileData`: the reference and a buffer of exactly its size, or a failure like `fileResult`'s */
function isFileData(m: Record<string, unknown>): boolean {
    if (!isPositiveInteger(m['requestId'])) return false;
    if (m['ok'] === true) {
        return (
            hasOnlyKeys(m, ['requestId', 'ok', 'file', 'data']) &&
            isFileReference(m['file']) &&
            isArrayBuffer(m['data']) &&
            m['data'].byteLength === (m['file'] as { size: number }).size
        );
    }
    return isFileResult(m);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(value: unknown): boolean {
    return isRecord(value) && Object.keys(value).every((key) => key === 'x' || key === 'y') && isFiniteNumber(value['x']) && isFiniteNumber(value['y']);
}

function isRect(value: unknown): boolean {
    return isRecord(value) && Object.keys(value).every((key) => ['x', 'y', 'width', 'height'].includes(key)) && ['x', 'y', 'width', 'height'].every((key) => isFiniteNumber(value[key]));
}

function isTracks(value: unknown): boolean {
    return value === undefined || (Array.isArray(value) && value.length <= MAX_INSPECT_CHILDREN && value.every(isFiniteNumber));
}

function isInspectedArea(value: unknown): boolean {
    return (
        isRecord(value) &&
        Object.keys(value).every((key) => ['rect', 'settings', 'flow', 'gap', 'columns', 'rows'].includes(key)) &&
        isRect(value['rect']) &&
        isRecord(value['settings']) &&
        Object.entries(value['settings']).every(([name, setting]) => isText(name, MAX_NAME_LENGTH) && isText(setting, MAX_NAME_LENGTH)) &&
        ['row', 'column', 'grid', 'free'].includes(value['flow'] as string) &&
        isRecord(value['gap']) &&
        isFiniteNumber(value['gap']['row']) &&
        isFiniteNumber(value['gap']['column']) &&
        isTracks(value['columns']) &&
        isTracks(value['rows'])
    );
}

function isInspectedNode(value: unknown): boolean {
    return (
        isRecord(value) &&
        Object.keys(value).every((key) => ['path', 'component', 'layout', 'rect', 'area', 'children'].includes(key)) &&
        (value['area'] === undefined || isInspectedArea(value['area'])) &&
        isText(value['path'], MAX_PATH_LENGTH) &&
        isText(value['component'], MAX_NAME_LENGTH) &&
        (value['layout'] === undefined || isText(value['layout'], MAX_NAME_LENGTH)) &&
        isRect(value['rect']) &&
        Array.isArray(value['children']) &&
        value['children'].length <= MAX_INSPECT_CHILDREN &&
        value['children'].every((child) => isRecord(child) && Object.keys(child).every((key) => key === 'path' || key === 'rect') && isText(child['path'], MAX_PATH_LENGTH) && isRect(child['rect']))
    );
}


/** The `active` of a `load`: theme overlay names by kind, a few at most */
function isActive(value: unknown): boolean {
    if (!isRecord(value)) return false;
    const entries = Object.entries(value);
    return entries.length <= MAX_ACTIVE && entries.every(([kind, name]) => isText(kind, MAX_NAME_LENGTH) && isText(name, MAX_NAME_LENGTH));
}

/** The `open` of a `load`: a screen name and its params */
function isOpen(value: unknown): boolean {
    return (
        isRecord(value) &&
        Object.keys(value).every((key) => key === 'screen' || key === 'params') &&
        isText(value['screen'], MAX_NAME_LENGTH) &&
        (value['params'] === undefined || isJson(value['params']))
    );
}

/** The structural check of the fields of each type; the envelope is already known to be sound */
const FIELD_CHECKS: Record<MessageType, (message: Record<string, unknown>) => boolean> = {
    load: (m) =>
        hasOnlyKeys(m, ['document', 'state', 'instance', 'icons', 'mode', 'chunks', 'keys', 'active', 'locale', 'open', 'files']) &&
        (m['mode'] === undefined || MODES.includes(m['mode'] as string)) &&
        isJsonObject(m['document']) &&
        isRecord(m['document']['app']) &&
        (m['state'] === undefined || (isRecord(m['state']) && isStateSnapshot(m['state']))) &&
        (m['instance'] === undefined || isInstance(m['instance'])) &&
        (m['icons'] === undefined || isIconsMap(m['icons'])) &&
        (m['chunks'] === undefined || isChunks(m['chunks'])) &&
        (m['keys'] === undefined || (Array.isArray(m['keys']) && m['keys'].length <= MAX_KEYS && m['keys'].every(isKeyChord))) &&
        (m['active'] === undefined || isActive(m['active'])) &&
        (m['locale'] === undefined || isLanguageCode(m['locale'])) &&
        (m['open'] === undefined || isOpen(m['open'])) &&
        (m['files'] === undefined || isFilesSource(m['files'])),
    write: (m) =>
        hasOnlyKeys(m, ['writes', 'icons']) &&
        Array.isArray(m['writes']) &&
        m['writes'].length <= MAX_WRITES &&
        m['writes'].every(isPathWrite) &&
        (m['icons'] === undefined || isIconsMap(m['icons'])),
    command: (m) =>
        hasOnlyKeys(m, ['target', 'command', 'value']) &&
        isText(m['target'], MAX_PATH_LENGTH) &&
        isText(m['command'], MAX_NAME_LENGTH) &&
        (m['value'] === undefined || isJson(m['value'])),
    locale: (m) => hasOnlyKeys(m, ['locale']) && isLanguageCode(m['locale']),
    grant: (m) => hasOnlyKeys(m, ['grant']) && isGrant(m['grant']),
    theme: (m) => hasOnlyKeys(m, ['kind', 'name']) && isText(m['kind'], MAX_NAME_LENGTH) && isText(m['name'], MAX_NAME_LENGTH),
    event: (m) =>
        hasOnlyKeys(m, ['name', 'payload']) &&
        isAppEvent(m['name']) &&
        (m['payload'] === undefined || isJson(m['payload'])),
    ready: (m) => hasOnlyKeys(m, []),
    change: (m) => hasOnlyKeys(m, ['change']) && isRuntimeChange(m['change']),
    raised: (m) =>
        hasOnlyKeys(m, ['id', 'event', 'value', 'row']) &&
        isText(m['id'], MAX_NAME_LENGTH) &&
        NODE_ID.test(m['id']) &&
        isText(m['event'], MAX_NAME_LENGTH) &&
        NAME.test(m['event']) &&
        (m['value'] === undefined || isJson(m['value'])) &&
        (m['row'] === undefined || isJson(m['row'])),
    error: (m) => hasOnlyKeys(m, ['errors']) && Array.isArray(m['errors']) && m['errors'].length > 0 && m['errors'].length <= MAX_ERRORS && m['errors'].every(isProtocolError),
    ping: (m) => hasOnlyKeys(m, ['id']) && isInteger(m['id']),
    pong: (m) => hasOnlyKeys(m, ['id']) && isInteger(m['id']),
    key: (m) => hasOnlyKeys(m, ['key']) && isKeyChord(m['key']),
    history: (m) => hasOnlyKeys(m, ['step']) && (m['step'] === 'undo' || m['step'] === 'redo'),
    decide: (m) =>
        hasOnlyKeys(m, ['action', 'id', 'note']) &&
        (m['action'] === 'approve' || m['action'] === 'reject' || m['action'] === 'withdraw') &&
        isText(m['id'], MAX_REQUEST_ID) &&
        (m['note'] === undefined || (m['action'] === 'reject' && isText(m['note'], MAX_REQUEST_NOTE))),
    inspect: (m) =>
        hasOnlyKeys(m, ['id', 'at', 'paths']) &&
        isInteger(m['id']) &&
        (m['at'] !== undefined) !== (m['paths'] !== undefined) &&
        (m['at'] === undefined || isPoint(m['at'])) &&
        (m['paths'] === undefined || (Array.isArray(m['paths']) && m['paths'].length <= MAX_INSPECT_NODES && m['paths'].every((path) => isText(path, MAX_PATH_LENGTH)))),
    watch: (m) => hasOnlyKeys(m, ['paths']) && Array.isArray(m['paths']) && m['paths'].length <= MAX_INSPECT_NODES && m['paths'].every((path) => isText(path, MAX_PATH_LENGTH)),
    watched: (m) =>
        hasOnlyKeys(m, ['nodes', 'floating']) &&
        Array.isArray(m['nodes']) &&
        m['nodes'].length <= MAX_INSPECT_NODES &&
        m['nodes'].every((node) => isRecord(node) && hasOnlyKeys(node, ['path', 'rect']) && isText(node['path'], MAX_PATH_LENGTH) && isRect(node['rect'])) &&
        (m['floating'] === undefined || (Array.isArray(m['floating']) && m['floating'].length <= MAX_FLOATING && m['floating'].every(isRect))),
    inspected: (m) =>
        hasOnlyKeys(m, ['id', 'at', 'nodes']) &&
        isInteger(m['id']) &&
        (m['at'] === undefined || isText(m['at'], MAX_PATH_LENGTH)) &&
        Array.isArray(m['nodes']) &&
        m['nodes'].length <= MAX_INSPECT_NODES &&
        m['nodes'].every(isInspectedNode),
    file: (m) =>
        hasOnlyKeys(m, ['requestId', 'name', 'size', 'mediaType', 'data']) &&
        isPositiveInteger(m['requestId']) &&
        isText(m['name'], MAX_FILE_NAME_LENGTH) &&
        typeof m['mediaType'] === 'string' &&
        m['mediaType'].length <= MAX_FILE_TYPE_LENGTH &&
        isInteger(m['size']) &&
        isArrayBuffer(m['data']) &&
        m['data'].byteLength === m['size'],
    fileCancel: (m) => hasOnlyKeys(m, ['requestId']) && isPositiveInteger(m['requestId']),
    fileProgress: (m) =>
        hasOnlyKeys(m, ['requestId', 'loaded', 'total']) &&
        isPositiveInteger(m['requestId']) &&
        isInteger(m['loaded']) &&
        isInteger(m['total']) &&
        (m['loaded'] as number) <= (m['total'] as number),
    fileResult: isFileResult,
    fileRead: (m) => hasOnlyKeys(m, ['requestId', 'id']) && isPositiveInteger(m['requestId']) && isText(m['id'], MAX_FILE_ID_LENGTH),
    fileData: isFileData,
    fileRelease: (m) => hasOnlyKeys(m, ['requestId', 'id']) && isPositiveInteger(m['requestId']) && isText(m['id'], MAX_FILE_ID_LENGTH),
    fileReleased: (m) => (m['ok'] === true ? hasOnlyKeys(m, ['requestId', 'ok']) && isPositiveInteger(m['requestId']) : isFileResult(m)),
    fileExport: (m) =>
        hasOnlyKeys(m, ['requestId', 'source', 'name', 'request']) &&
        isPositiveInteger(m['requestId']) &&
        typeof m['source'] === 'string' &&
        EXPORT_SOURCE_PATTERN.test(m['source']) &&
        typeof m['name'] === 'string' &&
        EXPORT_NAME_PATTERN.test(m['name']) &&
        readExportRequest(m['request']) !== undefined,
    fileExported: (m) => (m['ok'] === true ? hasOnlyKeys(m, ['requestId', 'ok', 'rows']) && isPositiveInteger(m['requestId']) && isInteger(m['rows']) : isFileResult(m))
};

function isMessageType(value: unknown): value is MessageType {
    return typeof value === 'string' && (MESSAGE_TYPES as readonly string[]).includes(value);
}

/** The serialised size of a value in UTF-8 bytes; undefined when it cannot be serialised */
function byteLength(value: unknown): number | undefined {
    try {
        const json = JSON.stringify(value);
        return json === undefined ? undefined : encoder.encode(json).length;
    } catch {
        return undefined;
    }
}

/**
 * The structural validator of the closed message set, used by the runtime and by the host. A message is valid when it
 * is an object of the current `PROTOCOL_VERSION` with a nonce, a known `type`, exactly the fields of that type, and a
 * serialised size within `MESSAGE_BYTE_LIMITS`. An unknown `type` is `unknown`, a size over the limit (or a value that
 * cannot be serialised) is `oversized`, anything else wrong is `invalid`. It does not compare the nonce: the caller does
 */
export function validateMessage(value: unknown): ValidationResult {
    if (!isRecord(value)) return { ok: false, reason: 'invalid' };
    if (!isMessageType(value['type'])) return { ok: false, reason: 'unknown' };
    const size = byteLength(value);
    if (size === undefined) return { ok: false, reason: 'invalid' };
    if (size > MESSAGE_BYTE_LIMITS[value['type']]) return { ok: false, reason: 'oversized' };
    if ((value['type'] === 'file' || value['type'] === 'fileData') && isArrayBuffer(value['data']) && value['data'].byteLength > MAX_FILE_BYTES) {
        return { ok: false, reason: 'oversized' };
    }
    if (value['v'] !== PROTOCOL_VERSION || !isText(value['nonce'], MAX_NONCE_LENGTH)) return { ok: false, reason: 'invalid' };
    return FIELD_CHECKS[value['type']](value) ? { ok: true, message: value as unknown as RuntimeMessage } : { ok: false, reason: 'invalid' };
}
