import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../core/resolve/index.js';
import { parseShape } from '../core/shape/index.js';
import type { AppDocument } from '../core/types.js';
import { FILE_EXPORT_EVENT } from '../dom/index.js';
import type { FileExportRequest } from '../dom/index.js';
import { PROTOCOL_VERSION } from './protocol.js';
import { FILE_EXPORT_TIMEOUT_MS } from './limits.js';
import { FileTransferError, startRuntime } from './index.js';
import type { FileExportSpec, RuntimeHandle } from './index.js';

const NONCE = 'nonce-exp';
const realSetTimeout = setTimeout;

const parsed = parseShape({ summary: 'Fixture', properties: { text: { type: 'string', default: '' } } }, 'fixture.state.json');
if (!parsed.shape) throw new Error(JSON.stringify(parsed.errors));
const library: ComponentLibrary = { label: { tier: 'root', tag: 'x-exp-label', shape: parsed.shape } };
defineComponent({ tag: 'x-exp-label', template: '<p>{{ $.text }}</p>' });

interface Posted {
    type: string;
    requestId?: number;
    [key: string]: unknown;
}

const SPEC: FileExportSpec = { source: '$.data.products', name: 'Products.csv', request: { columns: [{ key: 'name', field: 'name', title: 'Name' }], filter: 'a' } };

describe('exportFile in Chromium', () => {
    let host: HTMLElement;
    let handle: RuntimeHandle;
    let postMessage: ReturnType<typeof vi.fn<(message: unknown, origin: string, transfer?: Transferable[]) => void>>;
    let parent: { postMessage: typeof postMessage };
    let errorSpy: ReturnType<typeof vi.spyOn>;
    /** What the fake host answers a fileExport with; no answer when it returns undefined */
    let exportWith: (request: Posted) => Record<string, unknown> | undefined;

    const posted = (type: string): Posted[] => postMessage.mock.calls.map((call) => call[0] as Posted).filter((message) => message.type === type);
    const message = (type: string, fields: Record<string, unknown> = {}) => ({ v: PROTOCOL_VERSION, nonce: NONCE, type, ...fields });

    function send(data: unknown): void {
        const event = new MessageEvent('message', { data: structuredClone(data) });
        Object.defineProperty(event, 'source', { value: parent });
        window.dispatchEvent(event);
    }

    function fakeHost(data: unknown): void {
        const request = data as Posted;
        if (request.type !== 'fileExport') return;
        realSetTimeout(() => {
            const fields = exportWith(request);
            if (fields) send(message('fileExported', { requestId: request.requestId, ...fields }));
        }, 0);
    }

    /** Raises `ui-file-export` inside the app, as a table does, and gives the promise the dispatcher answered with */
    function raiseExport(spec: FileExportSpec): Promise<number> | undefined {
        let result: Promise<number> | undefined;
        const detail: FileExportRequest = { ...spec, respond: (promise) => (result = promise) };
        host.firstElementChild?.dispatchEvent(new CustomEvent(FILE_EXPORT_EVENT, { detail, bubbles: true, composed: true }));
        return result;
    }

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        host = document.body.appendChild(document.createElement('div'));
        exportWith = () => ({ ok: true, rows: 3 });
        postMessage = vi.fn((data: unknown) => fakeHost(data));
        parent = { postMessage };
        handle = startRuntime(window, parent, NONCE, library, { host });
        const app: AppDocument = { data: {}, app: { component: 'label', text: 'hi' } };
        send(message('load', { document: app }));
    });

    afterEach(() => {
        vi.useRealTimers();
        handle.dispose();
        errorSpy.mockRestore();
        document.body.replaceChildren();
    });

    it('should answer ui-file-export through the host: post fileExport with the settings and resolve with the rows written', async () => {
        // Act
        const result = raiseExport(SPEC);

        // Assert
        await expect(result).resolves.toBe(3);
        expect(posted('fileExport')).toEqual([expect.objectContaining({ v: PROTOCOL_VERSION, nonce: NONCE, requestId: 1, ...SPEC })]);
    });

    it('should reject with the code of a failed fileExported', async () => {
        // Arrange
        exportWith = () => ({ ok: false, code: 'too_large', message: 'Too many rows' });

        // Act
        const error = await raiseExport(SPEC)?.catch((failure: unknown) => failure);

        // Assert
        expect(error).toBeInstanceOf(FileTransferError);
        expect(error).toMatchObject({ code: 'too_large' });
    });

    it('should reject with internal and post nothing when the request is not a valid export', async () => {
        // Act
        const error = await raiseExport({ ...SPEC, source: '$.server.secret' })?.catch((failure: unknown) => failure);

        // Assert
        expect(error).toMatchObject({ code: 'internal' });
        expect(posted('fileExport')).toEqual([]);
    });

    it('should reject with offline when the host does not answer in time', async () => {
        // Arrange
        exportWith = () => undefined;
        vi.useFakeTimers();
        const failure = raiseExport(SPEC)?.catch((error: unknown) => error);

        // Act
        await vi.advanceTimersByTimeAsync(FILE_EXPORT_TIMEOUT_MS + 1);

        // Assert
        expect(await failure).toMatchObject({ code: 'offline' });
    });
});
