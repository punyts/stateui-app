import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../core/resolve/index.js';
import { parseShape } from '../core/shape/index.js';
import type { AppDocument } from '../core/types.js';
import { LOAD_3D_EVENT } from '../dom/index.js';
import type { Load3dRequest } from '../dom/index.js';
import { PROTOCOL_VERSION } from './protocol.js';
import { Load3dError, startRuntime } from './index.js';
import type { RuntimeHandle, Scene3dChunk } from './index.js';

const NONCE = 'nonce-3d';
/** The fake chunks in `fixtures/chunk3d`: one that sets `__stateui3d`, one that sets nothing, one that throws */
const GOOD = 'aaaaaaaaaaaaaaaa';
const NOT_A_CHUNK = 'bbbbbbbbbbbbbbbb';
const THROWS = 'cccccccccccccccc';
/** No file has this name, so the server answers 404 */
const MISSING = 'dddddddddddddddd';

const parsed = parseShape({ summary: 'Fixture', properties: { text: { type: 'string', default: '' } } }, 'fixture.state.json');
if (!parsed.shape) throw new Error(JSON.stringify(parsed.errors));
const library: ComponentLibrary = { label: { tier: 'root', tag: 'x-l3-label', shape: parsed.shape } };
defineComponent({ tag: 'x-l3-label', template: '<p>{{ $.text }}</p>' });

const scripts = (hash: string): HTMLScriptElement[] => Array.from(document.querySelectorAll<HTMLScriptElement>(`script[src$="/${hash}.js"]`));
const globals = globalThis as unknown as Record<string, unknown>;

describe('load3d in Chromium', () => {
    let host: HTMLElement;
    let base: HTMLBaseElement;
    let handle: RuntimeHandle;
    let postMessage: ReturnType<typeof vi.fn<(message: unknown, origin: string) => void>>;
    let parent: { postMessage: typeof postMessage };
    let errorSpy: ReturnType<typeof vi.spyOn>;

    const posted = (type: string): Record<string, unknown>[] =>
        postMessage.mock.calls.map((call) => call[0] as Record<string, unknown>).filter((message) => message['type'] === type);

    function send(fields: Record<string, unknown>): void {
        const event = new MessageEvent('message', { data: { v: PROTOCOL_VERSION, nonce: NONCE, type: 'load', ...fields } });
        Object.defineProperty(event, 'source', { value: parent });
        window.dispatchEvent(event);
    }

    function load(chunks?: Record<string, string>): void {
        const app: AppDocument = { data: {}, app: { component: 'label', text: 'scene' } };
        send({ document: app, ...(chunks === undefined ? {} : { chunks }) });
    }

    /** Raises `ui-load-3d` inside the app, as the scene3d controller does, and gives the promise the dispatcher answered with */
    function raiseLoad(): Promise<Scene3dChunk> | undefined {
        let result: Promise<Scene3dChunk> | undefined;
        const detail: Load3dRequest = { respond: (promise) => (result = promise) };
        host.firstElementChild?.dispatchEvent(new CustomEvent(LOAD_3D_EVENT, { detail, bubbles: true, composed: true }));
        return result;
    }

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
        // The runtime page names the chunk `./<hash>.js`; here the fixtures folder stands in for the runtime route
        base = document.head.appendChild(document.createElement('base'));
        base.href = '/src/runtime/fixtures/chunk3d/';
        host = document.body.appendChild(document.createElement('div'));
        postMessage = vi.fn();
        parent = { postMessage };
        handle = startRuntime(window, parent, NONCE, library, { host });
    });

    afterEach(() => {
        handle.dispose();
        errorSpy.mockRestore();
        for (const hash of [GOOD, NOT_A_CHUNK, THROWS, MISSING]) for (const script of scripts(hash)) script.remove();
        base.remove();
        delete globals['__stateui3d'];
        delete globals['__stateui3dRuns'];
        delete globals['__stateui3dNotAChunk'];
        document.body.replaceChildren();
    });

    it('should add the chunk script on the first ui-load-3d and resolve with __stateui3d', async () => {
        // Arrange
        load({ '3d': GOOD });
        expect(posted('ready')).toHaveLength(1);

        // Act
        const loading = raiseLoad();
        const chunk = await loading;

        // Assert
        expect(chunk).toBe(globals['__stateui3d']);
        expect(chunk?.version).toBe('fake');
        expect(scripts(GOOD)).toHaveLength(1);
        expect(new URL(scripts(GOOD)[0]?.src ?? '').pathname).toBe(`/src/runtime/fixtures/chunk3d/${GOOD}.js`);
    });

    it('should load the chunk once for every scene and every later load of the same hash', async () => {
        // Arrange
        load({ '3d': GOOD });
        const first = raiseLoad();
        await first;

        // Act
        const second = raiseLoad();
        load({ '3d': GOOD });
        const third = raiseLoad();
        await third;

        // Assert
        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(scripts(GOOD)).toHaveLength(1);
        expect(globals['__stateui3dRuns']).toBe(1);
    });

    it('should not request the chunk when nothing asks for it', async () => {
        // Arrange
        load({ '3d': GOOD });

        // Act
        await new Promise<void>((resolve) => setTimeout(resolve, 50));

        // Assert
        expect(scripts(GOOD)).toHaveLength(0);
        expect(globals['__stateui3d']).toBeUndefined();
    });

    it('should leave ui-load-3d unanswered when the load names no chunk', () => {
        // Arrange
        load();

        // Act
        const loading = raiseLoad();

        // Assert
        expect(loading).toBeUndefined();
        expect(document.querySelectorAll('script[src$=".js"][src*="chunk3d"]')).toHaveLength(0);
    });

    it('should reject with load_failed when the chunk is not found', async () => {
        // Arrange
        load({ '3d': MISSING });

        // Act
        const error = await raiseLoad()?.catch((thrown: unknown) => thrown);

        // Assert
        expect(error).toBeInstanceOf(Load3dError);
        expect(error).toMatchObject({ code: 'load_failed' });
    });

    it('should reject with script_error when the script does not set __stateui3d', async () => {
        // Arrange
        load({ '3d': NOT_A_CHUNK });

        // Act
        const error = await raiseLoad()?.catch((thrown: unknown) => thrown);

        // Assert
        expect(globals['__stateui3dNotAChunk']).toBe(true);
        expect(error).toMatchObject({ code: 'script_error' });
    });

    it('should reject with script_error when the script throws, and post no SUI-RUN-BINDING for it', async () => {
        // Arrange
        // The runner logs the thrown error to the console; as the runtime listens for window errors, it is not a failure
        load({ '3d': THROWS });

        // Act
        const error = await raiseLoad()?.catch((thrown: unknown) => thrown);

        // Assert
        expect(error).toMatchObject({ code: 'script_error' });
        expect((error as Error).message).toContain('The fake chunk is broken');
        expect(posted('error')).toHaveLength(0);
    });
});
