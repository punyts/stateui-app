import { CHUNK_LOAD_TIMEOUT_MS } from './limits.js';

/** The one global the 3D chunk script sets (`@punyts/stateui-3d`) */
export const SCENE3D_GLOBAL = '__stateui3d';

/**
 * What the 3D chunk puts in `globalThis.__stateui3d`: its version and the renderer's `createScene3d`. Typed loosely here,
 * as the runtime has no dependency on `@punyts/stateui-3d`; the `scene3d` controller uses the package's own types
 */
export interface Scene3dChunk {
    readonly version: string;
    readonly createScene3d: (...args: never[]) => unknown;
}

/**
 * Why the 3D chunk did not load: `load_failed` (the script was not served: a 404 or no network), `script_error` (the
 * script ran but threw, or did not set `__stateui3d`) or `timeout` (no answer within `CHUNK_LOAD_TIMEOUT_MS`)
 */
export type Load3dErrorCode = 'load_failed' | 'script_error' | 'timeout';

/** What the `load3d` hook rejects with */
export class Load3dError extends Error {
    constructor(
        readonly code: Load3dErrorCode,
        message: string
    ) {
        super(message);
        this.name = 'Load3dError';
    }
}

/**
 * The hook that loads the 3D renderer chunk and resolves with `globalThis.__stateui3d`; it rejects with a `Load3dError`.
 * Every call after the first returns the same promise
 */
export type Load3d = () => Promise<Scene3dChunk>;

export interface ChunkLoaderOptions {
    /** How long a load waits for the script; `CHUNK_LOAD_TIMEOUT_MS` when absent */
    timeoutMs?: number;
}

export interface ChunkLoader {
    /** The `load3d` hook for the chunk named `hash`: one `<script src="./<hash>.js">` for each hash, however often it is called */
    load3d(hash: string): Load3d;
    /** True for an error event of a chunk script that is still loading: its load rejects with `script_error`, so the window's error report skips it */
    owns(event: Event): boolean;
    /** Stops the timers of the loads that are still waiting; they never settle */
    dispose(): void;
}

function isChunk(value: unknown): value is Scene3dChunk {
    if (typeof value !== 'object' || value === null) return false;
    const chunk = value as Partial<Scene3dChunk>;
    return typeof chunk.version === 'string' && typeof chunk.createScene3d === 'function';
}

interface Pending {
    script: HTMLScriptElement;
    timer: ReturnType<typeof setTimeout> | undefined;
    /** The message of an error the script threw while it ran */
    thrown: string | undefined;
}

/**
 * The chunk loads of a runtime. The script is added to `doc`'s head as a classic script, `./<hash>.js` beside the
 * runtime page, which the frame's policy (`script-src 'self'`) allows; a module could not run in a frame of opaque
 * origin. A load resolves when the script has run and set `__stateui3d`, and rejects when the script element fails
 * (`load_failed`), when it ran without setting the global or threw (`script_error`), or after `timeoutMs` (`timeout`).
 * Loads are kept by hash for the life of the runtime, so a second `load` of the same document does not load it again
 */
export function createChunkLoader(doc: Document, options: ChunkLoaderOptions = {}): ChunkLoader {
    const timeoutMs = options.timeoutMs ?? CHUNK_LOAD_TIMEOUT_MS;
    const loads = new Map<string, Promise<Scene3dChunk>>();
    const pending = new Set<Pending>();

    function start(hash: string): Promise<Scene3dChunk> {
        return new Promise<Scene3dChunk>((resolve, reject) => {
            const script = doc.createElement('script');
            const entry: Pending = { script, timer: undefined, thrown: undefined };
            const settle = (): boolean => {
                if (!pending.has(entry)) return false;
                pending.delete(entry);
                clearTimeout(entry.timer);
                script.onload = null;
                script.onerror = null;
                return true;
            };
            script.onload = () => {
                if (!settle()) return;
                const chunk: unknown = (doc.defaultView as unknown as Record<string, unknown> | null)?.[SCENE3D_GLOBAL];
                if (entry.thrown === undefined && isChunk(chunk)) resolve(chunk);
                else reject(new Load3dError('script_error', entry.thrown ?? `The 3D chunk did not set ${SCENE3D_GLOBAL}`));
            };
            script.onerror = () => {
                if (settle()) reject(new Load3dError('load_failed', 'The 3D chunk script could not be loaded'));
            };
            entry.timer = setTimeout(() => {
                if (settle()) reject(new Load3dError('timeout', `The 3D chunk did not load within ${timeoutMs} ms`));
            }, timeoutMs);
            pending.add(entry);
            script.src = `./${hash}.js`;
            (doc.head ?? doc.documentElement).append(script);
        });
    }

    return {
        load3d(hash) {
            return () => {
                let load = loads.get(hash);
                if (load === undefined) {
                    load = start(hash);
                    loads.set(hash, load);
                }
                return load;
            };
        },
        owns(event) {
            const { filename, message } = event as Partial<ErrorEvent>;
            if (typeof filename !== 'string' || filename === '') return false;
            for (const entry of pending) {
                if (filename !== entry.script.src) continue;
                entry.thrown ??= typeof message === 'string' && message !== '' ? message : 'The 3D chunk script threw';
                return true;
            }
            return false;
        },
        dispose() {
            for (const entry of pending) clearTimeout(entry.timer);
            pending.clear();
        }
    };
}
