import { isIconsMap } from './icons.js';
import {
    MAX_ERROR_TEXT,
    MAX_ERRORS,
    MAX_NAME_LENGTH,
    MAX_NONCE_LENGTH,
    MAX_PATH_LENGTH,
    MAX_WRITES,
    MESSAGE_BYTE_LIMITS
} from './limits.js';
import { MESSAGE_TYPES, PROTOCOL_VERSION } from './messages.js';
import type { MessageType, RuntimeMessage } from './messages.js';

/** Why a message was dropped */
export type DropReason = 'invalid' | 'unknown' | 'oversized';

export type ValidationResult = { ok: true; message: RuntimeMessage } | { ok: false; reason: DropReason };

const encoder = new TextEncoder();
const WRITE_PATH = /^\$\.(data|app)(\.[^.\s]+)*$/;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const NAME = /^[A-Za-z][A-Za-z0-9_.:-]*$/;
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

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

/** True when `path` is a state path below `$.data` or `$.app` that a write may reach */
export function isWritablePath(path: unknown): path is string {
    if (typeof path !== 'string' || path.length > MAX_PATH_LENGTH || !WRITE_PATH.test(path)) return false;
    return path.split('.').every((segment) => !FORBIDDEN_SEGMENTS.has(segment));
}

function isPathWrite(value: unknown): boolean {
    if (!isRecord(value) || !isWritablePath(value['path'])) return false;
    if (!Object.keys(value).every((key) => key === 'path' || key === 'value' || key === 'remove')) return false;
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

/** The structural check of the fields of each type; the envelope is already known to be sound */
const FIELD_CHECKS: Record<MessageType, (message: Record<string, unknown>) => boolean> = {
    load: (m) =>
        hasOnlyKeys(m, ['document', 'state', 'icons']) &&
        isJsonObject(m['document']) &&
        isRecord(m['document']['app']) &&
        (m['state'] === undefined || (isRecord(m['state']) && isStateSnapshot(m['state']))) &&
        (m['icons'] === undefined || isIconsMap(m['icons'])),
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
    locale: (m) => hasOnlyKeys(m, ['locale']) && typeof m['locale'] === 'string' && m['locale'].length <= MAX_NAME_LENGTH && LOCALE.test(m['locale']),
    theme: (m) => hasOnlyKeys(m, ['kind', 'name']) && isText(m['kind'], MAX_NAME_LENGTH) && isText(m['name'], MAX_NAME_LENGTH),
    ready: (m) => hasOnlyKeys(m, []),
    snapshot: (m) => hasOnlyKeys(m, ['data', 'app']) && isStateSnapshot(m),
    emit: (m) => hasOnlyKeys(m, ['name', 'payload']) && isText(m['name'], MAX_NAME_LENGTH) && NAME.test(m['name']) && (m['payload'] === undefined || isJson(m['payload'])),
    error: (m) => hasOnlyKeys(m, ['errors']) && Array.isArray(m['errors']) && m['errors'].length > 0 && m['errors'].length <= MAX_ERRORS && m['errors'].every(isProtocolError),
    ping: (m) => hasOnlyKeys(m, ['id']) && isInteger(m['id']),
    pong: (m) => hasOnlyKeys(m, ['id']) && isInteger(m['id'])
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
    if (value['v'] !== PROTOCOL_VERSION || !isText(value['nonce'], MAX_NONCE_LENGTH)) return { ok: false, reason: 'invalid' };
    return FIELD_CHECKS[value['type']](value) ? { ok: true, message: value as unknown as RuntimeMessage } : { ok: false, reason: 'invalid' };
}
