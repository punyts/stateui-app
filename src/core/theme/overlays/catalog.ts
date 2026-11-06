import { isValid } from '../../errors/index.js';
import type { BuildError } from '../../errors/index.js';
import type { JsonObject, JsonValue, ThemeOverlay } from '../../types.js';
import { SHIPPED_OVERLAYS } from './shipped.js';
import { OVERLAY_KINDS, SYSTEM, SYSTEM_KINDS, isOverlayKind } from './types.js';
import type { ThemeOverlays, TokenOverlay } from './types.js';
import { overlayError, validateThemeOverlay } from './validate.js';

export interface OverlayCatalog {
    /** The shipped overlays plus the document overlays that passed validation */
    overlays: ThemeOverlays;
    /** Errors and warnings from the document overlays; an overlay with an error is not in `overlays` */
    errors: BuildError[];
}

function isTree(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when `name` is an overlay of the kind in the catalog */
export function hasOverlay(overlays: ThemeOverlays, kind: string, name: string): boolean {
    return Object.hasOwn(overlays, kind) && Object.hasOwn(overlays[kind] as object, name);
}

/**
 * The shipped overlays with the document's `themes` map added after the same validation as `validateThemeOverlay`.
 * A `mode` overlay named like a shipped mode (`light`, `dark`, `contrast`) refines it: its tokens are merged over the
 * shipped one's and the result takes its place, so `system` picks the theme's own light and dark. Any other name that
 * is already a shipped overlay of the same kind, or `system` for `mode` and `motion`, is
 * `SUI-THEME-OVERLAY`. An overlay with an error is left out; warnings do not leave one out. `base` is the state path
 * the overlays are reported under (`$.appThemes.{name}.overlays` for a theme of `appThemes`)
 */
export function buildOverlayCatalog(themes: Readonly<Record<string, ThemeOverlay>> | undefined, base = '$.themes'): OverlayCatalog {
    const overlays: Record<string, Record<string, TokenOverlay>> = {};
    for (const [kind, named] of Object.entries(SHIPPED_OVERLAYS)) overlays[kind] = { ...named };
    const errors: BuildError[] = [];

    for (const [name, theme] of Object.entries(themes ?? {})) {
        const statePath = `${base}.${name}`;
        const kind: unknown = theme.kind;
        const tokens: unknown = theme.tokens;
        if (typeof kind !== 'string' || !isOverlayKind(kind)) {
            errors.push(overlayError('kind', name, typeof kind === 'string' ? kind : '', statePath, statePath));
            continue;
        }
        if (!isTree(tokens)) {
            errors.push(overlayError('shape', name, kind, statePath, `${statePath}.tokens`));
            continue;
        }
        const shipped = (SHIPPED_OVERLAYS[kind] as Record<string, TokenOverlay> | undefined)?.[name];
        if (hasOverlay(overlays, kind, name) && (kind !== 'mode' || shipped === undefined)) {
            errors.push(overlayError('clash', name, kind, statePath, statePath));
            continue;
        }
        if (name === SYSTEM && SYSTEM_KINDS.includes(kind)) {
            errors.push(overlayError('reserved', name, kind, statePath, statePath));
            continue;
        }
        const merged = shipped === undefined ? tokens : mergeTokenTrees(shipped.tokens, tokens);
        const found = validateThemeOverlay(kind, merged, { name, statePath: `${statePath}.tokens` });
        errors.push(...found);
        if (isValid(found)) overlays[kind] = { ...overlays[kind], [name]: { tokens: merged } };
    }
    return { overlays, errors };
}

function mergeInto(target: Record<string, JsonValue>, source: JsonObject): void {
    for (const [key, value] of Object.entries(source)) {
        const existing = target[key];
        if (isTree(value)) {
            const next: Record<string, JsonValue> = isTree(existing) ? existing : {};
            target[key] = next;
            mergeInto(next, value);
        } else target[key] = value;
    }
}

/** Merges sparse token trees left to right into a new tree; later trees win. No input is changed */
export function mergeTokenTrees(...trees: readonly JsonObject[]): JsonObject {
    const result: Record<string, JsonValue> = {};
    for (const tree of trees) mergeInto(result, tree);
    return result;
}

/**
 * The sparse tree that applying the named overlay of each kind, in the order of `OVERLAY_KINDS`, produces.
 * A kind missing from `names` or a name that is not in the catalog contributes nothing
 */
export function composeOverlays(overlays: ThemeOverlays, names: Readonly<Record<string, string>>): JsonObject {
    const trees: JsonObject[] = [];
    for (const kind of OVERLAY_KINDS) {
        const name = names[kind];
        if (name !== undefined && hasOverlay(overlays, kind, name)) trees.push((overlays[kind] as Record<string, TokenOverlay>)[name]!.tokens);
    }
    return mergeTokenTrees(...trees);
}
