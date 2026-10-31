import { SYSTEM, SYSTEM_KINDS } from '../../core/theme/index.js';

/** The part of a `MediaQueryList` that following the system needs */
export interface MediaQueryLike {
    matches: boolean;
    addEventListener(type: 'change', listener: () => void): void;
    removeEventListener(type: 'change', listener: () => void): void;
}

/** The hook that reads the environment; tests inject their own so they can fire a change */
export interface SystemHooks {
    /** Defaults to `window.matchMedia`; without both, `system` means `light` and `full` and nothing is followed */
    matchMedia?(query: string): MediaQueryLike;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function reader(hooks: SystemHooks): ((query: string) => MediaQueryLike) | undefined {
    if (hooks.matchMedia) return (query) => hooks.matchMedia!(query);
    if (typeof globalThis.matchMedia === 'function') return (query) => globalThis.matchMedia(query);
    return undefined;
}

/** The `mode` overlay the system asks for: `dark` when the user prefers a dark scheme, otherwise `light`. Never `contrast` */
export function systemMode(hooks: SystemHooks): 'light' | 'dark' {
    return reader(hooks)?.(DARK_QUERY).matches ? 'dark' : 'light';
}

/** The `motion` overlay the system asks for: `reduced` when the user asks for reduced motion, otherwise `full` */
export function systemMotion(hooks: SystemHooks): 'reduced' | 'full' {
    return reader(hooks)?.(REDUCED_QUERY).matches ? 'reduced' : 'full';
}

/** Replaces `system` in `mode` and `motion` with the overlay name the browser asks for; other names stay as they are */
export function resolveSystem(active: Readonly<Record<string, string>>, hooks: SystemHooks): Record<string, string> {
    const resolved = { ...active };
    if (resolved.mode === SYSTEM) resolved.mode = systemMode(hooks);
    if (resolved.motion === SYSTEM) resolved.motion = systemMotion(hooks);
    return resolved;
}

/**
 * Calls `changed` with `mode` or `motion` when the matching media query changes. Returns a function that removes
 * both listeners. Nothing is listened to when the environment has no `matchMedia`
 */
export function followSystem(hooks: SystemHooks, changed: (kind: string) => void): () => void {
    const read = reader(hooks);
    if (!read) return () => undefined;
    const queries: [MediaQueryLike, () => void][] = [];
    for (const [kind, query] of [
        ['mode', DARK_QUERY],
        ['motion', REDUCED_QUERY]
    ] as const) {
        if (!SYSTEM_KINDS.includes(kind)) continue;
        const list = read(query);
        const listener = (): void => changed(kind);
        list.addEventListener('change', listener);
        queries.push([list, listener]);
    }
    return () => {
        for (const [list, listener] of queries) list.removeEventListener('change', listener);
    };
}
