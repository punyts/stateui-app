import { report } from '@punyts/core';
import { cloneJson } from '../../core/resolve/index.js';
import {
    OVERLAY_KINDS,
    buildOverlayCatalog,
    composeOverlays,
    hasOverlay,
    mergeOverDefaults,
    mergeTokenTrees,
    overlayError
} from '../../core/theme/index.js';
import type { JsonObject } from '../../core/types.js';
import { registerMountStep } from '../mount/steps.js';
import type { StartedContext } from '../mount/types.js';
import { followSystem, resolveSystem } from './system.js';

/** The names `$.theme.active` holds unless the document gives others */
export const DEFAULT_ACTIVE: Readonly<Record<string, string>> = { mode: 'light', brand: 'default', motion: 'full' };

export const THEME_STEP = 'theme';

const TOKENS_PATH = '$.theme.tokens';
const ACTIVE_PATH = '$.theme.active';

function readActive(context: StartedContext): Record<string, string> {
    const active: Record<string, string> = {};
    for (const kind of OVERLAY_KINDS) active[kind] = String(context.store.get(`${ACTIVE_PATH}.${kind}`));
    return active;
}

/**
 * Keeps the tokens in step with `$.theme.active` once the store exists. A change to `active.<kind>` applies that
 * overlay (the browser's choice for `system`), and a change of a media query re-applies `mode` or `motion` while it is
 * `system`. A name that is not an overlay is reported and changes nothing
 */
function follow(context: StartedContext): () => void {
    const { store, hooks } = context;
    const { overlays } = buildOverlayCatalog(context.document.themes);
    const applied: Record<string, string> = resolveSystem(readActive(context), hooks);

    const sync = (kind: string): void => {
        const name = resolveSystem({ [kind]: String(store.get(`${ACTIVE_PATH}.${kind}`)) }, hooks)[kind] as string;
        if (applied[kind] === name) return;
        if (!hasOverlay(overlays, kind, name)) {
            const error = overlayError('unknown', name, kind, `${ACTIVE_PATH}.${kind}`, `${ACTIVE_PATH}.${kind}`);
            report.error('theme overlay not applied', { code: error.code, kind });
            hooks.onError?.(error);
            return;
        }
        store.apply(TOKENS_PATH, cloneJson((overlays[kind] as Record<string, { tokens: JsonObject }>)[name]!.tokens));
        applied[kind] = name;
    };

    const listeners = OVERLAY_KINDS.map((kind): [string, () => void] => [`${ACTIVE_PATH}.${kind}`, () => sync(kind)]);
    for (const [path, listener] of listeners) store.on(path, listener);
    const stop = followSystem(hooks, sync);
    return () => {
        stop();
        for (const [path, listener] of listeners) store.off(path, listener);
    };
}

/**
 * Fills `$.theme` before the store exists: the active names over `{ mode: "light", brand: "default", motion: "full" }`
 * (`system` resolved from the browser), the overlay of each kind merged over the default tree, and the document's
 * `theme.tokens` last, so the document's own values win at start. Once the store exists it applies overlays when
 * `$.theme.active` changes and follows the browser while `mode` or `motion` is `system`. The document was validated by then
 */
registerMountStep(THEME_STEP, {
    prepare(context) {
        const theme = context.document.theme;
        const active = { ...DEFAULT_ACTIVE, ...(theme?.active ?? {}) };
        const { overlays } = buildOverlayCatalog(context.document.themes);
        const resolved = resolveSystem(active, context.hooks);
        const composed = mergeTokenTrees(composeOverlays(overlays, resolved), theme?.tokens ?? {});
        context.state.theme = { tokens: mergeOverDefaults(composed) as JsonObject, active };
    },
    start: follow
});
