import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHUNK_LOAD_TIMEOUT_MS } from './limits.js';
import { createChunkLoader, Load3dError, SCENE3D_GLOBAL } from './load3d.js';

const HASH = '0123456789abcdef';
const SRC = `https://runtime.test/runtime/${HASH}.js`;

interface FakeScript {
    src: string;
    onload: (() => void) | null;
    onerror: (() => void) | null;
}

/** A document that records the scripts the loader adds; the test fires their load and error by hand */
function fakeDocument() {
    const scripts: FakeScript[] = [];
    const view: Record<string, unknown> = {};
    const doc = {
        defaultView: view,
        head: { append: vi.fn() },
        createElement: vi.fn(() => {
            const script: FakeScript = { src: '', onload: null, onerror: null };
            // A browser resolves `src` against the page, as the error event's filename is
            Object.defineProperty(script, 'src', {
                get: () => (script as unknown as { raw?: string }).raw?.replace('./', 'https://runtime.test/runtime/') ?? '',
                set: (value: string) => Object.assign(script, { raw: value })
            });
            scripts.push(script);
            return script;
        })
    };
    return { doc: doc as unknown as Document, scripts, view };
}

const chunk = { version: '0.1.0', createScene3d: () => ({}) };

describe('3D chunk loader', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('should wait 15 s for the chunk', () => {
        expect(CHUNK_LOAD_TIMEOUT_MS).toBe(15_000);
    });

    it('should add one script ./<hash>.js and resolve with __stateui3d once it has run', async () => {
        // Arrange
        const { doc, scripts, view } = fakeDocument();
        const load3d = createChunkLoader(doc).load3d(HASH);

        // Act
        const loading = load3d();
        view[SCENE3D_GLOBAL] = chunk;
        scripts[0]?.onload?.();

        // Assert
        await expect(loading).resolves.toBe(chunk);
        expect(scripts).toHaveLength(1);
        expect(scripts[0]?.src).toBe(SRC);
        expect(doc.head.append).toHaveBeenCalledTimes(1);
    });

    it('should load once: later calls, and a second hook for the same hash, return the same promise', async () => {
        // Arrange
        const { doc, scripts, view } = fakeDocument();
        const loader = createChunkLoader(doc);
        const first = loader.load3d(HASH)();

        // Act
        const second = loader.load3d(HASH)();
        view[SCENE3D_GLOBAL] = chunk;
        scripts[0]?.onload?.();
        await first;
        const third = loader.load3d(HASH)();

        // Assert
        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(scripts).toHaveLength(1);
    });

    it('should load another hash with its own script', () => {
        // Arrange
        const { doc, scripts } = fakeDocument();
        const loader = createChunkLoader(doc);

        // Act
        loader.load3d(HASH)();
        loader.load3d('fedcba9876543210')();

        // Assert
        expect(scripts.map((script) => script.src)).toEqual([SRC, 'https://runtime.test/runtime/fedcba9876543210.js']);
    });

    it('should reject with load_failed when the script cannot be loaded, and keep that answer', async () => {
        // Arrange
        const { doc, scripts } = fakeDocument();
        const load3d = createChunkLoader(doc).load3d(HASH);

        // Act
        const loading = load3d();
        scripts[0]?.onerror?.();
        const error = await loading.catch((thrown: unknown) => thrown);

        // Assert
        expect(error).toBeInstanceOf(Load3dError);
        expect(error).toMatchObject({ code: 'load_failed' });
        expect(load3d()).toBe(loading);
        expect(scripts).toHaveLength(1);
    });

    it('should reject with script_error when the script ran without setting __stateui3d', async () => {
        // Arrange
        const { doc, scripts, view } = fakeDocument();
        const load3d = createChunkLoader(doc).load3d(HASH);

        // Act
        const loading = load3d();
        view[SCENE3D_GLOBAL] = { version: '0.1.0' };
        scripts[0]?.onload?.();

        // Assert
        await expect(loading).rejects.toMatchObject({ code: 'script_error' });
    });

    it('should take the error the script threw as its own and reject with script_error', async () => {
        // Arrange
        const { doc, scripts, view } = fakeDocument();
        const loader = createChunkLoader(doc);
        const loading = loader.load3d(HASH)();
        const thrown = { filename: SRC, message: 'Uncaught Error: broken' } as unknown as Event;
        const other = { filename: 'https://runtime.test/runtime/aaaaaaaaaaaaaaaa.js', message: 'x' } as unknown as Event;

        // Act
        const ownsThrown = loader.owns(thrown);
        const ownsOther = loader.owns(other);
        view[SCENE3D_GLOBAL] = chunk;
        scripts[0]?.onload?.();

        // Assert
        expect(ownsThrown).toBe(true);
        expect(ownsOther).toBe(false);
        await expect(loading).rejects.toMatchObject({ code: 'script_error', message: 'Uncaught Error: broken' });
        expect(loader.owns(thrown)).toBe(false);
    });

    it('should reject with timeout when the script neither loads nor fails within 15 s, and ignore a late load', async () => {
        // Arrange
        vi.useFakeTimers();
        const { doc, scripts, view } = fakeDocument();
        const load3d = createChunkLoader(doc).load3d(HASH);
        const loading = load3d();
        const failure = loading.catch((thrown: unknown) => thrown);

        // Act
        await vi.advanceTimersByTimeAsync(CHUNK_LOAD_TIMEOUT_MS - 1);
        const early = await Promise.race([failure, Promise.resolve('waiting')]);
        await vi.advanceTimersByTimeAsync(1);
        view[SCENE3D_GLOBAL] = chunk;
        scripts[0]?.onload?.();

        // Assert
        expect(early).toBe('waiting');
        expect(await failure).toMatchObject({ code: 'timeout' });
        expect(load3d()).toBe(loading);
    });

    it('should take the timeout from the options', async () => {
        // Arrange
        vi.useFakeTimers();
        const { doc } = fakeDocument();
        const failure = createChunkLoader(doc, { timeoutMs: 50 }).load3d(HASH)().catch((thrown: unknown) => thrown);

        // Act
        await vi.advanceTimersByTimeAsync(50);

        // Assert
        expect(await failure).toMatchObject({ code: 'timeout' });
    });
});
