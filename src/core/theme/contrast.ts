import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { referencesOf } from './references.js';
import { TOKENS_STATE_PATH } from './types.js';
import type { TokenTree } from './types.js';

/** The minimum contrast ratio for text, below which a pair is reported */
export const MIN_CONTRAST = 4.5;

/** The minimum contrast ratio for a data-visualisation colour against `color.surface.base` */
export const MIN_DATA_CONTRAST = 3;

const TONES = ['neutral', 'accent', 'danger', 'warning', 'success', 'info'] as const;
const MAX_CHAIN = 32;

type Rgb = [number, number, number];

function channel(hex: string): number {
    return Number.parseInt(hex.length === 1 ? hex + hex : hex, 16);
}

function hslToRgb(h: number, s: number, l: number): Rgb {
    const hue = (((h % 360) + 360) % 360) / 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const part = (t: number): number => {
        const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
    };
    return [part(hue + 1 / 3) * 255, part(hue) * 255, part(hue - 1 / 3) * 255];
}

/** Reads an opaque colour literal; translucent values and anything else give `undefined` */
function parseOpaque(text: string): Rgb | undefined {
    const value = text.trim().toLowerCase();
    const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1];
    if (hex !== undefined) {
        const size = hex.length <= 4 ? 1 : 2;
        const parts = [0, 1, 2, 3].slice(0, hex.length / size).map((i) => channel(hex.slice(i * size, i * size + size)));
        if (parts.length === 4 && parts[3] !== 255) return undefined;
        return [parts[0] as number, parts[1] as number, parts[2] as number];
    }
    const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(value);
    if (fn === null) return undefined;
    const numbers = (fn[2] as string).split(/[\s,/]+/).filter((part) => part !== '');
    if (numbers.length < 3 || numbers.length > 4) return undefined;
    const values = numbers.map((part) => Number.parseFloat(part));
    if (values.some((n) => Number.isNaN(n))) return undefined;
    const alpha = numbers[3] === undefined ? 1 : numbers[3].endsWith('%') ? (values[3] as number) / 100 : (values[3] as number);
    if (alpha !== 1) return undefined;
    if (fn[1]?.startsWith('rgb')) {
        return [0, 1, 2].map((i) => {
            const n = values[i] as number;
            return numbers[i]?.endsWith('%') ? (n / 100) * 255 : n;
        }) as Rgb;
    }
    return hslToRgb(values[0] as number, (values[1] as number) / 100, (values[2] as number) / 100);
}

function luminance([r, g, b]: Rgb): number {
    const linear = (c: number): number => {
        const s = Math.min(Math.max(c, 0), 255) / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The WCAG contrast ratio of two opaque colour literals; `undefined` when either is not an opaque literal */
export function contrastRatio(foreground: string, background: string): number | undefined {
    const a = parseOpaque(foreground);
    const b = parseOpaque(background);
    if (a === undefined || b === undefined) return undefined;
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (high + 0.05) / (low + 0.05);
}

function valueAt(tree: TokenTree, path: string): string | undefined {
    let cursor: string | TokenTree | undefined = tree;
    for (const segment of path.split('.')) {
        if (cursor === undefined || typeof cursor === 'string') return undefined;
        cursor = cursor[segment];
    }
    return typeof cursor === 'string' ? cursor : undefined;
}

/** Follows single references until a literal; `undefined` when the chain breaks or loops */
function resolveLiteral(tree: TokenTree, path: string): string | undefined {
    let current = valueAt(tree, path);
    for (let step = 0; step < MAX_CHAIN && current !== undefined; step += 1) {
        const refs = referencesOf(current);
        if (refs.length === 0) return current;
        const trimmed = current.trim();
        if (refs.length !== 1 || trimmed !== `{${refs[0]}}`) return undefined;
        current = valueAt(tree, refs[0] as string);
    }
    return undefined;
}

/** The paths of the leaves below `color.data`, in tree order */
function dataColorPaths(tree: TokenTree): string[] {
    const paths: string[] = [];
    const walk = (node: TokenTree | string | undefined, prefix: string): void => {
        if (node === undefined) return;
        if (typeof node === 'string') {
            paths.push(prefix);
            return;
        }
        for (const [key, child] of Object.entries(node)) walk(child, `${prefix}.${key}`);
    };
    const color = tree.color;
    const data = color === undefined || typeof color === 'string' ? undefined : color.data;
    walk(data, 'color.data');
    return paths;
}

/**
 * Checks `color.<tone>.base` against `color.<tone>.on` for every tone, and `color.text.base` against
 * `color.surface.base`, on the effective tree. A pair below 4.5:1 is a `SUI-THEME-CONTRAST` warning with both
 * state paths. Every `color.data.*` colour is checked against `color.surface.base` at 3:1 the same way. A pair that
 * does not resolve to opaque literal colours is skipped
 */
export function checkContrast(effectiveTree: TokenTree): BuildError[] {
    const pairs: [string, string][] = TONES.map((tone) => [`color.${tone}.base`, `color.${tone}.on`]);
    pairs.push(['color.text.base', 'color.surface.base']);

    const limits = new Map<string, number>();
    for (const path of dataColorPaths(effectiveTree)) {
        pairs.push([path, 'color.surface.base']);
        limits.set(path, MIN_DATA_CONTRAST);
    }

    const warnings: BuildError[] = [];
    for (const [first, second] of pairs) {
        const limit = limits.get(first as string) ?? MIN_CONTRAST;
        const a = resolveLiteral(effectiveTree, first as string);
        const b = resolveLiteral(effectiveTree, second as string);
        if (a === undefined || b === undefined) continue;
        const ratio = contrastRatio(a, b);
        if (ratio === undefined || ratio >= limit) continue;
        warnings.push(
            buildError('SUI-THEME-CONTRAST', {
                token: `${TOKENS_STATE_PATH}.${first}`,
                other: `${TOKENS_STATE_PATH}.${second}`,
                statePath: `${TOKENS_STATE_PATH}.${first}`,
                actual: Math.floor(ratio * 100) / 100,
                limit
            })
        );
    }
    return warnings;
}
