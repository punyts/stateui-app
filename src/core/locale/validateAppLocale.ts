import type { BuildError } from '../errors/index.js';
import { isObject } from '../resolve/merge.js';
import type { JsonObject, JsonValue } from '../types.js';
import { buildAppOverlay } from './buildAppOverlay.js';
import type { AppOverlayOptions, ComponentOverlays } from './buildAppOverlay.js';
import { extractBaseOverlay } from './extractBaseOverlay.js';
import { moreUntranslated, untranslated } from './errors.js';
import { validateLocaleOverlay } from './validateLocaleOverlay.js';

/** The most untranslated paths listed for one language; the rest are counted in one more warning */
export const MAX_MISSING_PER_LANGUAGE = 50;

/** The paths of the text in an overlay, in tree order; a content map gives one path per entry. Empty text is not content to translate */
function textPaths(value: JsonValue, path: string, found: string[] = []): string[] {
    if (typeof value === 'string') {
        if (value !== '') found.push(path);
    } else if (isObject(value)) {
        for (const [key, item] of Object.entries(value)) textPaths(item, `${path}.${key}`, found);
    }
    return found;
}

function has(overlay: JsonValue | undefined, segments: readonly string[]): boolean {
    let current = overlay;
    for (const segment of segments) {
        if (!isObject(current) || !Object.hasOwn(current, segment)) return false;
        current = current[segment];
    }
    return typeof current === 'string';
}

/**
 * The content paths of the application that the language's overlay does not translate: one `SUI-LOCALE-MISSING`
 * warning each, in tree order, naming the language and the state path, at most `MAX_MISSING_PER_LANGUAGE`, followed
 * by one warning that counts the rest. `base` is `extractBaseOverlay(tree, linkedPaths)`, `overlay` the assembled
 * overlay of the language. Content that is empty text is skipped, because there is nothing to translate
 */
export function findUntranslated(code: string, base: JsonObject, overlay: JsonObject, path = '$.app'): BuildError[] {
    const missing = textPaths(base, path).filter((item) => !has(overlay, item.slice(path.length).split('.').filter((part) => part !== '')));
    const warnings = missing.slice(0, MAX_MISSING_PER_LANGUAGE).map((item) => untranslated(code, item));
    if (missing.length > MAX_MISSING_PER_LANGUAGE) warnings.push(moreUntranslated(code, missing.length - MAX_MISSING_PER_LANGUAGE, MAX_MISSING_PER_LANGUAGE));
    return warnings;
}

/**
 * Validates one language of an application: the errors of `validateLocaleOverlay` for the document's own overrides
 * (`appOverrides`), then the `SUI-LOCALE-MISSING` warnings for every content path the assembled overlay
 * (`buildAppOverlay`) does not translate. `resolvedApp` is the resolved tree without linked properties and
 * `options.linkedPaths` lists them. A language with overlays for only some components is allowed: it gets the warnings
 * and no error. Pure
 */
export function validateAppLocale(
    code: string,
    resolvedApp: JsonObject,
    componentOverlays: ComponentOverlays,
    appOverrides: JsonObject,
    options: AppOverlayOptions = {}
): BuildError[] {
    const errors = validateLocaleOverlay(code, appOverrides, resolvedApp, {
        ...(options.linkedPaths === undefined ? {} : { linkedPaths: options.linkedPaths }),
        ...(options.library === undefined ? {} : { library: options.library }),
        ...(options.path === undefined ? {} : { path: options.path })
    });
    const overlay = buildAppOverlay(code, resolvedApp, componentOverlays, appOverrides, options);
    const base = extractBaseOverlay(resolvedApp, options.linkedPaths ?? [], options.path);
    return [...errors, ...findUntranslated(code, base, overlay, options.path)];
}
