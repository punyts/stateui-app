import type { ComponentLibrary } from '../core/resolve/index.js';
import { createRuntime } from './createRuntime.js';
import type { RuntimeOptions, RuntimeStats } from './createRuntime.js';

/** Where the runtime posts: `window.parent` in the iframe, a fake in tests */
export interface MessageTarget {
    postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
}

/** What `startRuntime` needs from the window: the `message` and error events */
export type RuntimeWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'document'>;

export interface RuntimeHandle {
    /** A copy of the counters */
    stats(): RuntimeStats;
    /** Removes the listeners and the mounted application. Safe to call more than once */
    dispose(): void;
}

/**
 * Starts the runtime inside the iframe (`createRuntime` on `options.host`, the body by default). It listens on `win` for
 * `message` events and hands `createRuntime` those whose `event.source` is `parent` (pass `window.parent`); one from
 * another source is dropped and counted. It also hands it the key chords the host named and the frame's errors and
 * rejections. Posting uses the target origin `*`: a frame sandboxed without `allow-same-origin` has an opaque origin,
 * and the nonce is what the host checks
 */
export function startRuntime(win: RuntimeWindow, parent: MessageTarget, nonce: string, library: ComponentLibrary, options: RuntimeOptions = {}): RuntimeHandle {
    const core = createRuntime({
        ...options,
        host: options.host ?? win.document.body,
        nonce,
        library,
        post: (message, transfer) => {
            if (transfer) parent.postMessage(message, '*', transfer);
            else parent.postMessage(message, '*');
        }
    });
    const onMessage = (event: MessageEvent): void => {
        if (event.source !== parent) core.foreign();
        else core.handle(event.data);
    };
    const onKey = (event: Event): void => core.key(event as KeyboardEvent);
    const onFailure = (event: Event): void => core.failure(event);
    win.addEventListener('message', onMessage);
    win.addEventListener('keydown', onKey, true);
    win.addEventListener('error', onFailure);
    win.addEventListener('unhandledrejection', onFailure);
    let disposed = false;
    return {
        stats: () => core.stats(),
        dispose(): void {
            if (disposed) return;
            disposed = true;
            win.removeEventListener('message', onMessage);
            win.removeEventListener('keydown', onKey, true);
            win.removeEventListener('error', onFailure);
            win.removeEventListener('unhandledrejection', onFailure);
            core.dispose();
        }
    };
}
