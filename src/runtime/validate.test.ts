import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_WRITES, MESSAGE_BYTE_LIMITS, MESSAGE_TYPES, PROTOCOL_VERSION, isIconsMap, isWritablePath, validateMessage } from './protocol.js';

const base = (type: string, fields: Record<string, unknown> = {}) => ({ v: PROTOCOL_VERSION, nonce: 'n', type, ...fields });

describe('runtime message validator', () => {
    it('should list the whole closed set', () => {
        expect([...MESSAGE_TYPES].sort()).toEqual(
            ['change', 'command', 'emit', 'error', 'event', 'file', 'fileCancel', 'fileData', 'fileProgress', 'fileRead', 'fileRelease', 'fileReleased', 'fileResult', 'inspect', 'inspected', 'key', 'load', 'locale', 'ping', 'pong', 'ready', 'theme', 'write']
        );
    });

    it.each([
        base('load', { document: { app: { component: 'panel' } }, state: { data: {}, app: {} }, icons: { a: { outline: ['M0 0'] } } }),
        base('load', { document: { app: { component: 'panel' } }, mode: 'full' }),
        base('load', { document: { app: { component: 'panel' } }, chunks: { '3d': '0123456789abcdef' } }),
        base('load', { document: { app: { component: 'panel' } }, chunks: {} }),
        base('load', {
            document: { app: { component: 'panel' } },
            instance: { app: {}, screens: { home: {} }, route: { screen: 'home', params: { id: 'p1' } }, theme: { active: { mode: 'dark' } }, data: { bag: {} } }
        }),
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
        base('fileResult', { requestId: 1, ok: false, code: 'quota', message: 'Full' }),
        base('fileRead', { requestId: 1, id: '0b6e8c1a-3f1e-4a52-9a43-2f4f1c8f2d10' }),
        base('fileData', { requestId: 1, ok: true, file: { id: 'f', name: 'a.png', size: 3, type: 'image/png' }, data: new ArrayBuffer(3) }),
        base('fileData', { requestId: 1, ok: false, code: 'not_found', message: 'Gone' }),
        base('fileRelease', { requestId: 1, id: '0b6e8c1a-3f1e-4a52-9a43-2f4f1c8f2d10' }),
        base('fileReleased', { requestId: 1, ok: true }),
        base('fileReleased', { requestId: 1, ok: false, code: 'offline', message: 'Gone' })
    ])('should accept a valid $type message', (value) => {
        expect(validateMessage(value).ok).toBe(true);
    });

    it.each([
        ['not an object', 'x'],
        ['wrong version', { ...base('ping', { id: 1 }), v: 2 }],
        ['no nonce', { v: 1, type: 'ping', id: 1 }],
        ['extra field', base('ping', { id: 1, more: true })],
        ['load without app', base('load', { document: {} })],
        ['load with a chunk hash that is too short', base('load', { document: { app: { component: 'panel' } }, chunks: { '3d': '0123456789abcde' } })],
        ['load with an upper-case chunk hash', base('load', { document: { app: { component: 'panel' } }, chunks: { '3d': '0123456789ABCDEF' } })],
        ['load with a chunk path', base('load', { document: { app: { component: 'panel' } }, chunks: { '3d': '../0123456789abcd' } })],
        ['load with an unknown chunk', base('load', { document: { app: { component: 'panel' } }, chunks: { '2d': '0123456789abcdef' } })],
        ['load with chunks that are not an object', base('load', { document: { app: { component: 'panel' } }, chunks: ['0123456789abcdef'] })],
        ['load with an unknown mode', base('load', { document: { app: { component: 'panel' } }, mode: 'cloud' })],
        ['load with an instance without screens', base('load', { document: { app: { component: 'panel' } }, instance: { app: {} } })],
        ['load with a route without a screen', base('load', { document: { app: { component: 'panel' } }, instance: { app: {}, screens: {}, route: { params: {} } } })],
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
        ['fileProgress with loaded above total', base('fileProgress', { requestId: 1, loaded: 4, total: 3 })],
        ['fileRead without an id', base('fileRead', { requestId: 1 })],
        ['fileRead with an empty id', base('fileRead', { requestId: 1, id: '' })],
        ['fileRead with a long id', base('fileRead', { requestId: 1, id: 'x'.repeat(129) })],
        ['fileRead with requestId 0', base('fileRead', { requestId: 0, id: 'f' })],
        ['fileData whose buffer differs from the size', base('fileData', { requestId: 1, ok: true, file: { id: 'f', name: 'a', size: 4, type: 'image/png' }, data: new ArrayBuffer(3) })],
        ['fileData whose data is a typed array', base('fileData', { requestId: 1, ok: true, file: { id: 'f', name: 'a', size: 3, type: 'image/png' }, data: new Uint8Array(3) })],
        ['fileData without data', base('fileData', { requestId: 1, ok: true, file: { id: 'f', name: 'a', size: 3, type: 'image/png' } })],
        ['fileData with an extra field', base('fileData', { requestId: 1, ok: true, file: { id: 'f', name: 'a', size: 3, type: 'image/png' }, data: new ArrayBuffer(3), more: 1 })],
        ['fileData with an unknown code', base('fileData', { requestId: 1, ok: false, code: 'nope', message: 'm' })],
        ['failed fileData with data', base('fileData', { requestId: 1, ok: false, code: 'internal', message: 'm', data: new ArrayBuffer(1) })],
        ['fileRelease without an id', base('fileRelease', { requestId: 1 })],
        ['fileRelease with an empty id', base('fileRelease', { requestId: 1, id: '' })],
        ['fileRelease with a long id', base('fileRelease', { requestId: 1, id: 'x'.repeat(129) })],
        ['fileRelease with requestId 0', base('fileRelease', { requestId: 0, id: 'f' })],
        ['fileRelease with an extra field', base('fileRelease', { requestId: 1, id: 'f', more: 1 })],
        ['fileReleased with a file reference', base('fileReleased', { requestId: 1, ok: true, file: { id: 'f', name: 'a', size: 3, type: 'image/png' } })],
        ['fileReleased without ok', base('fileReleased', { requestId: 1 })],
        ['fileReleased without a requestId', base('fileReleased', { ok: true })],
        ['fileReleased with an unknown code', base('fileReleased', { requestId: 1, ok: false, code: 'nope', message: 'm' })],
        ['failed fileReleased without a message', base('fileReleased', { requestId: 1, ok: false, code: 'internal' })]
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

    it('should report a fileData buffer over MAX_FILE_BYTES and a fileRead over the JSON limit as oversized', () => {
        const data = new ArrayBuffer(MAX_FILE_BYTES + 1);
        const file = { id: 'f', name: 'a.png', size: data.byteLength, type: 'image/png' };
        expect(validateMessage(base('fileData', { requestId: 1, ok: true, file, data }))).toEqual({ ok: false, reason: 'oversized' });
        expect(validateMessage(base('fileRead', { requestId: 1, id: 'x'.repeat(3000) }))).toEqual({ ok: false, reason: 'oversized' });
        expect(MESSAGE_BYTE_LIMITS.fileRead).toBe(2 * 1024);
        expect(MESSAGE_BYTE_LIMITS.fileData).toBe(2 * 1024);
    });

    it('should report a fileRelease and a fileReleased over the JSON limit as oversized, with the small file limit', () => {
        expect(validateMessage(base('fileRelease', { requestId: 1, id: 'x'.repeat(3000) }))).toEqual({ ok: false, reason: 'oversized' });
        expect(validateMessage(base('fileReleased', { requestId: 1, ok: false, code: 'internal', message: 'x'.repeat(3000) }))).toEqual({ ok: false, reason: 'oversized' });
        expect(MESSAGE_BYTE_LIMITS.fileRelease).toBe(2 * 1024);
        expect(MESSAGE_BYTE_LIMITS.fileReleased).toBe(2 * 1024);
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

    it('should take key chords with a modifier on load, and a key message that names one', () => {
        const document = { app: { component: 'panel' } };
        expect(validateMessage(base('load', { document, keys: ['mod+shift+e', 'alt+1', 'mod+k'] })).ok).toBe(true);
        expect(validateMessage(base('key', { key: 'mod+shift+e' })).ok).toBe(true);
        for (const keys of [['e'], ['shift+mod+e'], ['mod+shift+E'], ['mod+enter'], ['mod+ctrl+e'], 'mod+e', Array.from({ length: 17 }, () => 'mod+e')]) {
            expect(validateMessage(base('load', { document, keys })).ok, JSON.stringify(keys)).toBe(false);
        }
        expect(validateMessage(base('key', { key: 'e' })).ok).toBe(false);
        expect(validateMessage(base('key', { key: 'mod+e', extra: 1 })).ok).toBe(false);
    });

    it('should take an inspect of a point or of paths, and an inspected answer with boxes', () => {
        const rect = { x: 0, y: 0, width: 10, height: 20 };
        expect(validateMessage(base('inspect', { id: 1, at: { x: 4, y: 5.5 } })).ok).toBe(true);
        expect(validateMessage(base('inspect', { id: 2, paths: ['$.screens.home'] })).ok).toBe(true);
        expect(validateMessage(base('inspect', { id: 3 })).ok).toBe(false);
        expect(validateMessage(base('inspect', { id: 3, at: { x: 1, y: 1 }, paths: [] })).ok).toBe(false);
        expect(validateMessage(base('inspect', { id: 3, at: { x: 'a', y: 1 } })).ok).toBe(false);
        expect(validateMessage(base('inspect', { id: 3, paths: Array.from({ length: 51 }, () => '$.app') })).ok).toBe(false);
        const node = { path: '$.app', component: 'panel', layout: 'column', rect, children: [{ path: '$.app.children.a', rect }] };
        expect(validateMessage(base('inspected', { id: 1, at: '$.app', nodes: [node] })).ok).toBe(true);
        expect(validateMessage(base('inspected', { id: 1, nodes: [] })).ok).toBe(true);
        expect(validateMessage(base('inspected', { id: 1, nodes: [{ ...node, rect: { x: 0 } }] })).ok).toBe(false);
        expect(validateMessage(base('inspected', { id: 1, nodes: [{ ...node, extra: true }] })).ok).toBe(false);
    });
});
