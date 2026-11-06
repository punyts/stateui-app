import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ThemePartOverlay } from '../core/blueprint/index.js';
import { buildError, isValid } from '../core/errors/index.js';
import type { BuildError } from '../core/errors/index.js';
import { MAX_SUMMARY_LENGTH } from '../core/shape/index.js';
import type { ComponentToken } from '../core/theme/index.js';
import { isOverlayKind, validateThemeOverlay } from '../core/theme/overlays/index.js';
import { validateTokens } from '../core/theme/validate.js';
import type { JsonObject, JsonValue } from '../core/types.js';

/** A lower-case hyphenated name, as for component and pattern folders */
const PRESET_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SUFFIX = '.preset.json';
const KEYS = ['summary', 'tokens', 'overlays'];

/** The catalog entry of a theme preset that passed every check: a theme part with its name and one-line summary */
export interface ThemePresetCatalogEntry {
    /** The file name without `.preset.json`, lower-case hyphenated */
    name: string;
    summary: string;
    /** The base tokens, a sparse token tree */
    tokens: JsonObject;
    /** Overlays by name, each with its kind; empty when the file has none */
    overlays: Record<string, ThemePartOverlay>;
}

/** What `buildPresets` returns: the entries sorted by name, and every blocking problem found */
export interface BuiltPresets {
    themePresets: ThemePresetCatalogEntry[];
    errors: BuildError[];
}

function isObject(value: JsonValue | undefined): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads one preset: its shape (`SUI-PRESET-SHAPE` by path), then the base tokens through `validateTokens` and each
 * overlay through `validateThemeOverlay`. Warnings (the overlay contrast check) are not build errors here: the
 * presets' contrast is checked where a theme is written. `preset` is set only when there is no blocking error
 */
export function readPreset(json: unknown, file: string, name: string, componentTokens: readonly ComponentToken[] = []): { preset?: ThemePresetCatalogEntry; errors: BuildError[] } {
    const shape = (path: string, reason: string): { errors: BuildError[] } => ({ errors: [buildError('SUI-PRESET-SHAPE', { file, path, reason })] });
    if (!isObject(json as JsonValue)) return shape('$', 'must be an object with summary and tokens');
    const body = json as JsonObject;
    const extra = Object.keys(body).filter((key) => !KEYS.includes(key));
    if (extra.length > 0) return shape(`$.${extra[0]}`, `is not a preset key; the keys are ${KEYS.join(', ')}`);
    const { summary, tokens, overlays = {} } = body;
    if (typeof summary !== 'string' || summary.trim() === '') return shape('$.summary', 'must be a one-line phrase');
    if (/[\r\n]/.test(summary)) return shape('$.summary', 'must be on one line');
    if (summary.length > MAX_SUMMARY_LENGTH) return shape('$.summary', `is longer than ${MAX_SUMMARY_LENGTH} characters`);
    if (!isObject(tokens)) return shape('$.tokens', 'must be a token tree');
    if (!isObject(overlays)) return shape('$.overlays', 'must be an object of overlays by name');

    const errors: BuildError[] = validateTokens(tokens, { componentTokens }).map((error) => ({ ...error, file }));
    const read: Record<string, ThemePartOverlay> = {};
    for (const [overlayName, overlay] of Object.entries(overlays)) {
        const at = `$.overlays.${overlayName}`;
        if (!isObject(overlay)) return shape(at, 'must be { kind, tokens }');
        const { kind, tokens: overlayTokens } = overlay;
        if (typeof kind !== 'string' || !isOverlayKind(kind)) return shape(`${at}.kind`, 'must be mode, brand or motion');
        if (!isObject(overlayTokens)) return shape(`${at}.tokens`, 'must be a token tree');
        const problems = validateThemeOverlay(kind, overlayTokens, { name: overlayName, statePath: `${at}.tokens` }).filter((error) => error.severity !== 'warning');
        errors.push(...problems.map((error) => ({ ...error, file })));
        read[overlayName] = { kind, tokens: overlayTokens };
    }
    if (!isValid(errors)) return { errors };
    return { preset: { name, summary, tokens, overlays: read }, errors };
}

/**
 * Reads a folder of `<name>.preset.json` files, each a theme part with a one-line summary, and checks each with
 * `readPreset`. A file with another name or in a sub-folder, or that is not JSON, is `SUI-PRESET-FILE`; files are
 * named relative to the folder. A preset with any problem is left out
 */
export async function buildPresets(presetsDir: string, componentTokens: readonly ComponentToken[] = []): Promise<BuiltPresets> {
    const errors: BuildError[] = [];
    const themePresets: ThemePresetCatalogEntry[] = [];
    const entries = (await readdir(presetsDir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
        const file = entry.name;
        const name = file.endsWith(SUFFIX) ? file.slice(0, -SUFFIX.length) : '';
        if (!entry.isFile() || !PRESET_NAME.test(name)) {
            errors.push(buildError('SUI-PRESET-FILE', { file, reason: `must be a file <name>${SUFFIX}, the name lower-case hyphenated, directly in the presets folder` }));
            continue;
        }
        let json: unknown;
        try {
            json = JSON.parse(await readFile(join(presetsDir, file), 'utf8'));
        } catch {
            errors.push(buildError('SUI-PRESET-FILE', { file, reason: 'could not be read as JSON' }));
            continue;
        }
        const result = readPreset(json, file, name, componentTokens);
        errors.push(...result.errors);
        if (result.preset !== undefined) themePresets.push(result.preset);
    }
    return { themePresets, errors };
}
