import type * as StateUI from '@punyts/stateui';

/** The StateUI compile functions, loaded once a DOM exists */
export type StateUIModule = typeof StateUI;

let loaded: Promise<StateUIModule> | undefined;

/**
 * Loads `@punyts/stateui` for the build. StateUI extends `HTMLElement` when it loads, so it is imported only
 * after a DOM exists: the one the host already has (a browser, a test environment), or a happy-dom window
 * installed on `globalThis`. happy-dom is a dev dependency, so a Node build needs it installed
 */
export function loadStateUI(): Promise<StateUIModule> {
    loaded ??= load();
    return loaded;
}

async function load(): Promise<StateUIModule> {
    if (typeof globalThis.customElements === 'undefined') {
        const { GlobalWindow } = await import('happy-dom');
        const window = new GlobalWindow();
        for (const key of Object.getOwnPropertyNames(window)) {
            if (key in globalThis) continue;
            Object.defineProperty(globalThis, key, { configurable: true, get: () => (window as unknown as Record<string, unknown>)[key] });
        }
    }

    return import('@punyts/stateui');
}
