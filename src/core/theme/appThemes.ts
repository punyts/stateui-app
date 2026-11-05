import type { AppDocument, JsonObject, ThemeOverlay } from '../types.js';
import { hasOverlay } from './overlays/catalog.js';
import { SHIPPED_OVERLAYS } from './overlays/shipped.js';
import { OVERLAY_KINDS, SYSTEM, SYSTEM_KINDS } from './overlays/types.js';
import type { ThemeOverlays } from './overlays/types.js';

/** The key of `$.theme.active` that names the active theme of an app with `appThemes` */
export const THEME_KEY = 'theme';

/** The tokens and overlays one theme gives: an entry of `appThemes`, or the document's `theme.tokens` and `themes` */
export interface ThemeSource {
    tokens: JsonObject;
    overlays?: Record<string, ThemeOverlay>;
}

type ThemeDocument = Pick<AppDocument, 'theme' | 'themes' | 'appThemes'>;

/** The names of the app's themes in order; empty for a document without `appThemes` */
export function appThemeNames(document: ThemeDocument): string[] {
    return Object.keys(document.appThemes ?? {});
}

/** True when the document lists a theme of that name */
export function hasAppTheme(document: ThemeDocument, name: unknown): name is string {
    return typeof name === 'string' && document.appThemes !== undefined && Object.hasOwn(document.appThemes, name);
}

/**
 * The theme an app starts with: `requested` when the app has it, then the document's `theme.active.theme`, then the
 * first of `appThemes`. Undefined for a document without `appThemes`
 */
export function startTheme(document: ThemeDocument, requested?: string): string | undefined {
    if (hasAppTheme(document, requested)) return requested;
    const own = document.theme?.active?.[THEME_KEY];
    if (hasAppTheme(document, own)) return own;
    return appThemeNames(document)[0];
}

/** The tokens and overlays of the named theme; the document's own `theme.tokens` and `themes` without that theme */
export function themeSource(document: ThemeDocument, name: string | undefined): ThemeSource {
    if (hasAppTheme(document, name)) {
        const entry = (document.appThemes as Record<string, ThemeSource>)[name] as ThemeSource;
        return { tokens: entry.tokens ?? {}, ...(entry.overlays === undefined ? {} : { overlays: entry.overlays }) };
    }
    return { tokens: document.theme?.tokens ?? {}, ...(document.themes === undefined ? {} : { overlays: document.themes }) };
}

/** How a refused theme name names the app's themes in `SUI-STATE-INVALID` */
export function themeWords(document: ThemeDocument): string {
    return `the app's themes (${appThemeNames(document).join(', ')})`;
}

/**
 * The active overlay name of each kind once the theme with `catalog` (the shipped overlays plus its own, from
 * `buildOverlayCatalog`) and its own `overlays` is active: a name the new theme has stays, and `system` stays for
 * `mode` and `motion`; any other name falls back to the theme's own first overlay of that kind, then to `system` for
 * `mode` and `motion`, then to the first shipped overlay of the kind (`default` for `brand`)
 */
export function activeAfterSwitch(
    active: Readonly<Record<string, string>>,
    catalog: ThemeOverlays,
    overlays: Readonly<Record<string, ThemeOverlay>> | undefined
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const kind of OVERLAY_KINDS) {
        const name = active[kind];
        const system = SYSTEM_KINDS.includes(kind);
        if (name !== undefined && (hasOverlay(catalog, kind, name) || (system && name === SYSTEM))) {
            result[kind] = name;
            continue;
        }
        const own = Object.entries(overlays ?? {}).find(([candidate, overlay]) => overlay.kind === kind && hasOverlay(catalog, kind, candidate));
        if (own !== undefined) result[kind] = own[0];
        else if (system) result[kind] = SYSTEM;
        else result[kind] = Object.keys(SHIPPED_OVERLAYS[kind] ?? {})[0] as string;
    }
    return result;
}
