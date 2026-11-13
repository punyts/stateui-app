import { MAX_PATH_DATA_LENGTH } from '../shape/types.js';
import { VALIDATORS } from '../shape/validators.js';
import type { JsonObject, JsonValue } from '../types.js';

/** Most icons an app may carry of its own */
export const MAX_APP_ICONS = 64;

/** Most paths in one variant (`outline` or `filled`) of an app icon */
export const MAX_APP_ICON_PATHS = 16;

/** Longest name of an app icon */
export const MAX_APP_ICON_NAME_LENGTH = 64;

/** An app icon's name: lower-case words joined by hyphens, as the names of the icon set are */
const APP_ICON_NAME = /^[a-z0-9][a-z0-9-]*$/;

const PATH_KEYS = ['d', 'fill', 'stroke', 'opacity'];
const ICON_KEYS = ['outline', 'filled'];

/**
 * One path of an app icon in a 24×24 view box: SVG path data, or `{ d, fill?, stroke?, opacity? }` for a path the
 * icon fills (`fill: true`), draws without a stroke (`stroke: false`) or fades (`opacity` from 0 to 1)
 */
export type AppIconPath = string | { d: string; fill?: true; stroke?: false; opacity?: number };

/** An icon an app carries of its own: the paths of its outline, and of a filled variant when it has one */
export interface AppIcon {
    outline: AppIconPath[];
    filled?: AppIconPath[];
}

/** One thing wrong with an app's icons: where, and why */
export interface AppIconProblem {
    path: string;
    reason: string;
}

function isRecord(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for path data the `pathData` validator accepts: it parses, with at most `MAX_PATH_DATA_LENGTH` characters */
function isPathData(value: unknown): value is string {
    return typeof value === 'string' && VALIDATORS.pathData.check(value as JsonValue, true as never);
}

function pathProblems(value: JsonValue | undefined, path: string): AppIconProblem[] {
    if (typeof value === 'string') {
        return isPathData(value) ? [] : [{ path, reason: `must be SVG path data of at most ${MAX_PATH_DATA_LENGTH} characters` }];
    }
    if (!isRecord(value)) return [{ path, reason: 'a path is path data or { "d", "fill", "stroke", "opacity" }' }];
    const problems: AppIconProblem[] = [];
    for (const key of Object.keys(value)) {
        if (!PATH_KEYS.includes(key)) problems.push({ path: `${path}.${key}`, reason: `unknown key "${key}"` });
    }
    if (!isPathData(value['d'])) problems.push({ path: `${path}.d`, reason: `must be SVG path data of at most ${MAX_PATH_DATA_LENGTH} characters` });
    if (value['fill'] !== undefined && value['fill'] !== true) problems.push({ path: `${path}.fill`, reason: 'must be true when given' });
    if (value['stroke'] !== undefined && value['stroke'] !== false) problems.push({ path: `${path}.stroke`, reason: 'must be false when given' });
    const opacity = value['opacity'];
    if (opacity !== undefined && !(typeof opacity === 'number' && Number.isFinite(opacity) && opacity >= 0 && opacity <= 1)) {
        problems.push({ path: `${path}.opacity`, reason: 'must be a number from 0 to 1' });
    }
    return problems;
}

function pathListProblems(value: JsonValue | undefined, path: string): AppIconProblem[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_APP_ICON_PATHS) {
        return [{ path, reason: `must be a list of 1 to ${MAX_APP_ICON_PATHS} paths` }];
    }
    return value.flatMap((entry, index) => pathProblems(entry, `${path}.${index}`));
}

/**
 * What is wrong with an app's `icons`: a map of at most `MAX_APP_ICONS` icons, each named in lower-case words joined
 * by hyphens, holding an `outline` list (and optionally `filled`) of 1 to `MAX_APP_ICON_PATHS` paths. A path is SVG
 * path data only (commands and numbers that parse, at most `MAX_PATH_DATA_LENGTH` characters), so no markup, `url(`
 * or other attribute can ride in it. Empty when the icons are valid
 */
export function appIconProblems(value: JsonValue | undefined, path = '$.icons'): AppIconProblem[] {
    if (!isRecord(value)) return [{ path, reason: 'must be a map of icon name to { "outline", "filled" }' }];
    const names = Object.keys(value);
    if (names.length > MAX_APP_ICONS) return [{ path, reason: `has ${names.length} icons, over the ${MAX_APP_ICONS} an app may carry` }];
    const problems: AppIconProblem[] = [];
    for (const name of names) {
        const at = `${path}.${name}`;
        if (name.length > MAX_APP_ICON_NAME_LENGTH || !APP_ICON_NAME.test(name)) {
            problems.push({ path: at, reason: `the name "${name}" must be lower-case letters, digits and hyphens, at most ${MAX_APP_ICON_NAME_LENGTH} characters` });
            continue;
        }
        const icon = value[name];
        if (!isRecord(icon)) {
            problems.push({ path: at, reason: 'an icon is { "outline": [paths], "filled"?: [paths] }' });
            continue;
        }
        for (const key of Object.keys(icon)) {
            if (!ICON_KEYS.includes(key)) problems.push({ path: `${at}.${key}`, reason: `unknown key "${key}"` });
        }
        problems.push(...pathListProblems(icon['outline'], `${at}.outline`));
        if (icon['filled'] !== undefined) problems.push(...pathListProblems(icon['filled'], `${at}.filled`));
    }
    return problems;
}

/** The names of a document's or blueprint's own icons; empty when it has none or they are not a map */
export function appIconNames(icons: unknown): ReadonlySet<string> {
    return isRecord(icons) ? new Set(Object.keys(icons)) : new Set();
}
