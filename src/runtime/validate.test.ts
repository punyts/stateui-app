import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_WRITES, MESSAGE_TYPES, PROTOCOL_VERSION, isIconsMap, isWritablePath, validateMessage } from './protocol.js';

const base = (type: string, fields: Record<string, unknown> = {}) => ({ v: PROTOCOL_VERSION, nonce: 'n', type, ...fields });

describe('runtime message validator', () => {
    it('should list the whole closed set', () => {
        expect([...MESSAGE_TYPES].sort()).toEqual(
            ['change', 'command', 'emit', 'error', 'event', 'file', 'fileCancel', 'fileProgress', 'fileResult', 'load', 'locale', 'ping', 'pong', 'ready', 'theme', 'write']
        );
    });

    it.each([
        base('load', { document: { app: { component: 'panel' } }, state: { data: {}, app: {} }, icons: { a: { outline: ['M0 0'] } } }),
        base('load', { document: { app: { component: 'panel' } }, mode: 'full' }),
        base('write', { writes: [{ path: '$.data.a', value: 1 }, { path: '$.app.children.x', remove: true }] }),
        base('write', { writes: [{ path: '$.runtime.sync', value: { mode: 'full', status: 'offline', waiting: 2 } }, { path: '$.theme.mode', value: 'dark' }] }),
        base('event', { name: 'sync.rejected', payload: { path: '$.data.a', reason: 'no' } }),
        base('command', { target: '$.app.children.x', command: 'open', value: 'a' }),
        base('locale', { locale: 'de-CH' }),
        base('theme', { kind: 'mode', name: 'dark' }),
        base('ready'),
        base('change', { change: { id: 'c1', path: '$.data.a', op: 'set', value: 1 } }),
        base('change', { change: { id: 'c2', path: '$.app.children.x', op: 'delete' } }),
        base('emit', { name: 'order.saved', payload: { id: 1 } }),
        base('error', { errors: [{ code: 'SUI-RUN-WRITE', message: 'm', severity: 'error', statePath: '$.data.a' }] }),
        base('ping', { id: 1 }),
        base('pong', { id: 1 }),
        base('file', { requestId: 1, name: 'a.txt', size: 3, mediaType: 'text/plain', data: new ArrayBuffer(3) }),
        base('fileCancel', { requestId: 1 }),
        base('fileProgress', { requestId: 1, loaded: 1, total: 3 }),
        base('fileResult', { requestId: 1, ok: true, file: { id: 'f', name: 'a.txt', size: 3, type: 'text/plain' } }),
        base('fileResult', { requestId: 1, ok: false, code: 'quota', message: 'Full' })
    ])('should accept a valid $type message', (value) => {
        expect(validateMessage(value).ok).toBe(true);
    });

    it.each([
        ['not an object', 'x'],
        ['wrong version', { ...base('ping', { id: 1 }), v: 2 }],
        ['no nonce', { v: 1, type: 'ping', id: 1 }],
        ['extra field', base('ping', { id: 1, more: true })],
        ['load without app', base('load', { document: {} })],
        ['load with an unknown mode', base('load', { document: { app: { component: 'panel' } }, mode: 'cloud' })],
        ['event that is not an app event', base('event', { name: 'press' })],
        ['change without an id', base('change', { change: { path: '$.data.a', op: 'set', value: 1 } })],
        ['change with an unknown op', base('change', { change: { id: 'c', path: '$.data.a', op: 'push', value: 1 } })],
        ['change set without a value', base('change', { change: { id: 'c', path: '$.data.a', op: 'set' } })],
        ['change to $.runtime', base('change', { change: { id: 'c', path: '$.runtime.sync.status', op: 'set', value: 'x' } })],
        ['change to $.server', base('change', { change: { id: 'c', path: '$.server.token', op: 'set', value: 'x' } })],
        ['change with a long id', base('change', { change: { id: 'x'.repeat(129), path: '$.data.a', op: 'set', value: 1 } })],
        ['write to $.server', base('write', { writes: [{ path: '$.server.token', value: 1 }] })],
        ['write to $.runtime', base('write', { writes: [{ path: '$.runtime.icons.a', value: 1 }] })],
        ['write to a prototype path', base('write', { writes: [{ path: '$.data.__proto__.x', value: 1 }] })],
        ['write with value and remove', base('write', { writes: [{ path: '$.data.a', value: 1, remove: true }] })],
        ['write without value', base('write', { writes: [{ path: '$.data.a' }] })],
        ['too many writes', base('write', { writes: Array.from({ length: MAX_WRITES + 1 }, () => ({ path: '$.data.a', value: 1 })) })],
        ['bad locale', base('locale', { locale: 'not a locale' })],
        ['empty error list', base('error', { errors: [] })],
        ['emit name with spaces', base('emit', { name: 'a b' })],
        ['file with a size that differs from the buffer', base('file', { requestId: 1, name: 'a', size: 4, mediaType: 'text/plain', data: new ArrayBuffer(3) })],
        ['file whose data is a typed array', base('file', { requestId: 1, name: 'a', size: 3, mediaType: 'text/plain', data: new Uint8Array(3) })],
        ['file without a media type', base('file', { requestId: 1, name: 'a', size: 3, data: new ArrayBuffer(3) })],
        ['fileResult with an unknown code', base('fileResult', { requestId: 1, ok: false, code: 'nope', message: 'm' })],
        ['fileProgress with loaded above total', base('fileProgress', { requestId: 1, loaded: 4, total: 3 })]
    ])('should reject %s as invalid', (_name, value) => {
        expect(validateMessage(value)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('should report an unknown type and an oversized message', () => {
        expect(validateMessage(base('explode'))).toEqual({ ok: false, reason: 'unknown' });
        expect(validateMessage(base('emit', { name: 'a', payload: 'x'.repeat(70 * 1024) }))).toEqual({ ok: false, reason: 'oversized' });
    });

    it('should report a file buffer over MAX_FILE_BYTES as oversized and a long fileResult message as oversized', () => {
        const data = new ArrayBuffer(MAX_FILE_BYTES + 1);
        expect(validateMessage(base('file', { requestId: 1, name: 'a', size: data.byteLength, mediaType: 'text/plain', data }))).toEqual({ ok: false, reason: 'oversized' });
        expect(validateMessage(base('fileResult', { requestId: 1, ok: false, code: 'internal', message: 'x'.repeat(3000) })).ok).toBe(false);
    });

    it('should treat a value that cannot be serialised as oversized or invalid, never throw', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic['self'] = cyclic;

        expect(validateMessage(base('change', { change: { id: 'c', path: '$.data.a', op: 'set', value: cyclic } })).ok).toBe(false);
    });

    it('should accept writable paths only in the synced branches and the sync status', () => {
        expect(isWritablePath('$.data')).toBe(true);
        expect(isWritablePath('$.app.children.a.component')).toBe(true);
        expect(isWritablePath('$.theme.tokens')).toBe(true);
        expect(isWritablePath('$.locale')).toBe(true);
        expect(isWritablePath('$.runtime.sync.status')).toBe(true);
        expect(isWritablePath('$.runtime.icons')).toBe(false);
        expect(isWritablePath('$.server.token')).toBe(false);
        expect(isWritablePath('$.data..a')).toBe(false);
    });

    it('should check icons hold only path data', () => {
        expect(isIconsMap({ star: { outline: ['M12 2l3 7h7z', { d: 'M0 0', fill: true }], filled: ['M1 1'] } })).toBe(true);
        expect(isIconsMap({ star: { outline: ['url(javascript:1)'] } })).toBe(false);
        expect(isIconsMap({ star: { outline: [{ d: 'M0 0', onload: 'x' }] } })).toBe(false);
        expect(isIconsMap({ Star: { outline: [] } })).toBe(false);
        expect(isIconsMap({ star: { outline: [], extra: [] } })).toBe(false);
    });
});
