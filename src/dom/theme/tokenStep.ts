import { report } from '@punyts/core';
import { buildError } from '../../core/errors/index.js';
import { cloneJson } from '../../core/resolve/index.js';
import {
    OVERLAY_KINDS,
    THEME_KEY,
    activeAfterSwitch,
    buildOverlayCatalog,
    hasAppTheme,
    startTheme,
    themeSource,
    themeWords,
    composeOverlays,
    hasOverlay,
    mergeOverDefaults,
    mergeTokenTrees,
    overlayError
} from '../../core/theme/index.js';
import type { ThemeSource } from '../../core/theme/index.js';
import type { JsonObject } from '../../core/types.js';
import { registerMountStep } from '../mount/steps.js';
import type { MountContext, StartedContext } from '../mount/types.js';
import { followSystem, resolveSystem } from './system.js';

/** The names `$.theme.active` holds unless the document gives others */
export const DEFAULT_ACTIVE: Readonly<Record<string, string>> = { mode: 'light', brand: 'default', motion: 'full' };

export const THEME_STEP = 'theme';

const TOKENS_PATH = '$.theme.tokens';
const ACTIVE_PATH = '$.theme.active';

/**
 * Creates the empty objects above a component token's path, so a write to `<group>.<token>` has a parent to land in.
 * The leaf itself stays absent: an unset component token renders no property and the CSS fallback applies
 */
function openGroups(tokens: JsonObject, path: string): void {
    let cursor = tokens;
    for (const segment of path.split('.').slice(0, -1)) {
        const next = cursor[segment];
        if (typeof next === 'object' && next !== null && !Array.isArray(next)) cursor = next;
        else {
            const created: JsonObject = {};
            cursor[segment] = created;
            cursor = created;
        }
    }
}

function readActive(context: StartedContext): Record<string, string> {
    const active: Record<string, string> = {};
    for (const kind of OVERLAY_KINDS) active[kind] = String(context.store.get(`${ACTIVE_PATH}.${kind}`));
    return active;
}

/**
 * The whole token tree of a theme: the overlays the active names pick (`system` resolved from the browser) merged over
 * the default tree, the theme's own tokens last, and the groups of the component tokens opened
 */
function themeTokens(source: ThemeSource, active: Readonly<Record<string, string>>, context: MountContext): JsonObject {
    const { overlays } = buildOverlayCatalog(source.overlays);
    const resolved = resolveSystem(active, context.hooks);
    const tokens = mergeOverDefaults(mergeTokenTrees(composeOverlays(overlays, resolved), source.tokens)) as JsonObject;
    for (const token of context.componentTokens) openGroups(tokens, token.path);
    return tokens;
}

/**
 * Keeps the tokens in step with `$.theme.active` once the store exists. A change to `active.<kind>` applies that
 * overlay (the browser's choice for `system`), and a change of a media query re-applies `mode` or `motion` while it is
 * `system`. A name that is not an overlay is reported and changes nothing. In an app with `appThemes`, a change to
 * `active.theme` rebuilds the tokens from the new theme with the overlay names `activeAfterSwitch` keeps; a name the
 * app does not have is `SUI-STATE-INVALID` and the active theme is set back
 */
function follow(context: StartedContext): () => void {
    const { store, hooks, document } = context;
    let theme = context.state.theme.active[THEME_KEY];
    let source = themeSource(document, theme);
    let overlays = buildOverlayCatalog(source.overlays).overlays;
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

    const switchTheme = (): void => {
        const path = `${ACTIVE_PATH}.${THEME_KEY}`;
        const name: unknown = store.get(path);
        if (name === theme) return;
        if (!hasAppTheme(document, name)) {
            const error = buildError('SUI-STATE-INVALID', { name: THEME_KEY, path, component: themeWords(document), statePath: path });
            report.error('theme not switched', { code: error.code });
            hooks.onError?.(error);
            store.set(path, theme as never);
            return;
        }
        theme = name;
        source = themeSource(document, name);
        overlays = buildOverlayCatalog(source.overlays).overlays;
        const active = activeAfterSwitch(readActive(context), overlays, source.overlays);
        Object.assign(applied, resolveSystem(active, hooks));
        store.set(TOKENS_PATH, themeTokens(source, active, context) as never);
        for (const kind of OVERLAY_KINDS) {
            if (store.get(`${ACTIVE_PATH}.${kind}`) !== active[kind]) store.set(`${ACTIVE_PATH}.${kind}`, active[kind] as never);
        }
    };

    const listeners = OVERLAY_KINDS.map((kind): [string, () => void] => [`${ACTIVE_PATH}.${kind}`, () => sync(kind)]);
    if (theme !== undefined) listeners.push([`${ACTIVE_PATH}.${THEME_KEY}`, switchTheme]);
    for (const [path, listener] of listeners) store.on(path, listener);
    const stop = followSystem(hooks, sync);
    return () => {
        stop();
        for (const [path, listener] of listeners) store.off(path, listener);
    };
}

/**
 * Fills `$.theme` before the store exists: the instance's active names (`MountOptions.instance`) over the document's over
 * `{ mode: "light", brand: "default", motion: "full" }` (`system` resolved from the browser), the overlay of each kind
 * merged over the default tree, and the theme's tokens last, so its own values win at start. In an app with
 * `appThemes`, `active.theme` names the theme (the instance's, the document's, or the first), whose tokens and overlays
 * are used. Once the store exists it applies overlays when `$.theme.active` changes and follows the browser while
 * `mode` or `motion` is `system`. The document was validated by then
 */
registerMountStep(THEME_STEP, {
    prepare(context) {
        const document = context.document;
        const theme = startTheme(document, context.instanceActive[THEME_KEY]);
        const active: Record<string, string> = { ...DEFAULT_ACTIVE, ...(document.theme?.active ?? {}), ...context.instanceActive };
        if (theme === undefined) delete active[THEME_KEY];
        else active[THEME_KEY] = theme;
        context.state.theme = { tokens: themeTokens(themeSource(document, theme), active, context), active };
    },
    start: follow
});
