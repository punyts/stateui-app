import type { BuildError } from '../../core/errors/index.js';
import { cloneJson } from '../../core/resolve/index.js';
import { hasOverlay, overlayError } from '../../core/theme/index.js';
import type { ThemeOverlays } from '../../core/theme/index.js';
import type { JsonObject } from '../../core/types.js';

const TOKENS_PATH = '$.theme.tokens';
const ACTIVE_PATH = '$.theme.active';

/** The part of a store that applying an overlay needs */
export interface ThemeStore {
    apply: (path: string, source: unknown) => void;
    set: (path: string, value: string) => boolean;
}

/**
 * Applies the overlay `name` of `kind`: `store.apply('$.theme.tokens', overlay.tokens)` (a sparse merge, on a copy),
 * then sets `$.theme.active.<kind>` to `name`. Going back is applying the other overlay of the kind, so dark to light
 * applies `light`. An unknown kind or name is `SUI-THEME-OVERLAY` and changes nothing. `system` is not an overlay:
 * set `$.theme.active.mode` or `motion` to it to follow the browser
 */
export function applyOverlay(store: ThemeStore, kind: string, name: string, overlays: ThemeOverlays): BuildError[] {
    if (!hasOverlay(overlays, kind, name)) {
        const statePath = `${ACTIVE_PATH}.${kind}`;
        return [overlayError(Object.hasOwn(overlays, kind) ? 'unknown' : 'kind', name, kind, statePath, statePath)];
    }
    const overlay = (overlays[kind] as Record<string, { tokens: JsonObject }>)[name]!;
    store.apply(TOKENS_PATH, cloneJson(overlay.tokens));
    store.set(`${ACTIVE_PATH}.${kind}`, name);
    return [];
}
