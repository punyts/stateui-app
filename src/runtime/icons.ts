import { MAX_ICON_PATHS, MAX_ICON_PATH_LENGTH, MAX_ICONS, MAX_ICONS_BYTES, MAX_NAME_LENGTH } from './limits.js';
import type { IconPathData, IconsMap } from './messages.js';

/** SVG path data uses only commands, numbers, separators and signs */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/;
const ICON_NAME = /^[a-z0-9][a-z0-9-]*$/;
const encoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).every((key) => keys.includes(key));
}

function isPathData(value: unknown): value is string {
    return typeof value === 'string' && value.length <= MAX_ICON_PATH_LENGTH && PATH_DATA.test(value);
}

function isIconPath(value: unknown): value is IconPathData {
    if (typeof value === 'string') return isPathData(value);
    if (!isRecord(value) || !hasOnly(value, ['d', 'fill', 'stroke', 'opacity']) || !isPathData(value['d'])) return false;
    if (value['fill'] !== undefined && value['fill'] !== true) return false;
    if (value['stroke'] !== undefined && value['stroke'] !== false) return false;
    const opacity = value['opacity'];
    return opacity === undefined || (typeof opacity === 'number' && Number.isFinite(opacity) && opacity >= 0 && opacity <= 1);
}

function isPathList(value: unknown): value is IconPathData[] {
    return Array.isArray(value) && value.length <= MAX_ICON_PATHS && value.every(isIconPath);
}

/**
 * True when `value` is an icons map the runtime may write to `$.runtime.icons`: at most `MAX_ICONS` icons named in
 * lower-case words, each with an `outline` list (and optionally `filled`) of at most `MAX_ICON_PATHS` paths, each path
 * only SVG path data (commands, numbers and separators) of at most `MAX_ICON_PATH_LENGTH` characters, and the whole map
 * at most `MAX_ICONS_BYTES` serialised
 */
export function isIconsMap(value: unknown): value is IconsMap {
    if (!isRecord(value)) return false;
    const names = Object.keys(value);
    if (names.length > MAX_ICONS) return false;
    for (const name of names) {
        const icon = value[name];
        if (name.length > MAX_NAME_LENGTH || !ICON_NAME.test(name) || !isRecord(icon) || !hasOnly(icon, ['outline', 'filled'])) return false;
        if (!isPathList(icon['outline'])) return false;
        if (icon['filled'] !== undefined && !isPathList(icon['filled'])) return false;
    }
    return encoder.encode(JSON.stringify(value)).length <= MAX_ICONS_BYTES;
}
