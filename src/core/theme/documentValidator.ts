import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { collectComponentTokens } from '../shape/componentTokens.js';
import { registerDocumentValidator } from '../validate/registry.js';
import type { DocumentValidationContext } from '../validate/types.js';
import { validateNodeThemes } from './nodeOverrides.js';
import { buildOverlayCatalog, hasOverlay } from './overlays/catalog.js';
import { SYSTEM, SYSTEM_KINDS, isOverlayKind } from './overlays/types.js';
import { overlayError } from './overlays/validate.js';
import type { ComponentToken } from './types.js';
import { validateTokens } from './validate.js';

/** The name the theme validator is registered under; a later story that extends it registers this name again */
export const THEME_VALIDATOR = 'theme';

function wrongType(key: string, statePath: string): BuildError {
    return buildError('SUI-DOC-TYPE', { key, path: statePath, statePath });
}

/** The component tokens the library's shapes declare; they join the token lookup */
function libraryTokens(context: DocumentValidationContext): ComponentToken[] {
    const sources = Object.values(context.library).flatMap((entry) =>
        entry.tier === 'root' ? [{ file: entry.tag, shape: entry.shape }] : []
    );
    return collectComponentTokens(sources).tokens;
}

/**
 * Checks the document's `theme`: `tokens` must be an object that passes `validateTokens` (names, paths, value types,
 * injection characters and references), and `active` a map of names. An invalid token stops the run with `SUI-THEME-*`
 * before anything renders
 */
export function validateThemeTokens(context: DocumentValidationContext): BuildError[] {
    const theme = context.document.theme;
    if (typeof theme !== 'object' || theme === null) return [];
    const errors: BuildError[] = [];
    const tokens: unknown = theme.tokens;
    if (tokens !== undefined) {
        if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) {
            errors.push(wrongType('tokens', '$.theme.tokens'));
        } else {
            errors.push(...validateTokens(theme.tokens ?? {}, { componentTokens: libraryTokens(context) }));
        }
    }
    const active: unknown = theme.active;
    if (active !== undefined) {
        const valid =
            typeof active === 'object' &&
            active !== null &&
            !Array.isArray(active) &&
            Object.values(active).every((name) => typeof name === 'string');
        if (!valid) errors.push(wrongType('active', '$.theme.active'));
    }
    return errors;
}

/**
 * Checks the document's overlays: every entry of `themes` (`buildOverlayCatalog`: kind, groups, values, clashes) and
 * every name in `theme.active`, which must be an overlay of its kind in the shipped set plus `themes`, or `system` for
 * `mode` and `motion`. An unknown kind or name is `SUI-THEME-OVERLAY`
 */
export function validateThemeOverlays(context: DocumentValidationContext): BuildError[] {
    const { overlays, errors } = buildOverlayCatalog(context.document.themes);
    const active: unknown = context.document.theme?.active;
    if (typeof active !== 'object' || active === null || Array.isArray(active)) return errors;
    for (const [kind, name] of Object.entries(active)) {
        const statePath = `$.theme.active.${kind}`;
        if (typeof name !== 'string') continue;
        if (!isOverlayKind(kind)) errors.push(overlayError('kind', name, kind, statePath, statePath));
        else if (name === SYSTEM && SYSTEM_KINDS.includes(kind)) continue;
        else if (!hasOverlay(overlays, kind, name)) errors.push(overlayError('unknown', name, kind, statePath, statePath));
    }
    return errors;
}

/** The registered `theme` validator: the tokens and active names, the overlays, then every node's `theme` override */
export function validateTheme(context: DocumentValidationContext): BuildError[] {
    return [
        ...validateThemeTokens(context),
        ...validateThemeOverlays(context),
        ...validateNodeThemes(context, libraryTokens(context))
    ];
}

registerDocumentValidator(THEME_VALIDATOR, validateTheme);
