import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../types.js';
import { SHIPPED_OVERLAYS, composeOverlays } from './overlays/index.js';
import { MIN_DATA_CONTRAST, checkContrast, contrastRatio } from './contrast.js';
import { DEFAULT_LEAVES, DEFAULT_TOKENS, flattenTokens, tokenLayer } from './defaults.js';
import { DEFAULT_TOKEN_DESCRIPTIONS } from './descriptions.js';
import { cssName } from './names.js';
import { validateReferences } from './references.js';
import type { TokenTree } from './types.js';
import { mergeOverDefaults, validateTokens } from './validate.js';

const MODES = ['light', 'dark', 'contrast'] as const;
const CATEGORICAL = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `color.data.categorical.${n}`);
const SEQUENTIAL = [1, 2, 3, 4, 5, 6, 7].map((n) => `color.data.sequential.${n}`);
const DIVERGING = ['neg3', 'neg2', 'neg1', 'zero', 'pos1', 'pos2', 'pos3'].map((step) => `color.data.diverging.${step}`);
const DATA_PATHS = [...CATEGORICAL, ...SEQUENTIAL, ...DIVERGING];

/** The distance two colours must keep after a deficiency is simulated (CIE76 delta E in CIELAB) */
const MIN_DISTANCE = 25;

type Rgb = [number, number, number];
type Matrix = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

/** Machado, Oliveira and Fernandes (2009), severity 1.0, applied to linear RGB */
const DEFICIENCIES: Readonly<Record<string, Matrix>> = {
    protanopia: [
        [0.152286, 1.052583, -0.204868],
        [0.114503, 0.786281, 0.099216],
        [-0.003882, -0.048116, 1.051998]
    ],
    deuteranopia: [
        [0.367322, 0.860646, -0.227968],
        [0.280085, 0.672501, 0.047413],
        [-0.01182, 0.04294, 0.968881]
    ],
    tritanopia: [
        [1.255528, -0.076749, -0.178779],
        [-0.078411, 0.930809, 0.147602],
        [0.004733, 0.691367, 0.3039]
    ]
};

function toLinear(hex: string): Rgb {
    const channel = (offset: number): number => {
        const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return [channel(1), channel(3), channel(5)];
}

function simulate(linear: Rgb, matrix: Matrix | undefined): Rgb {
    if (matrix === undefined) return linear;
    return matrix.map((row) => Math.min(1, Math.max(0, row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2]))) as Rgb;
}

function toLab([r, g, b]: Rgb): Rgb {
    const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function distance(a: string, b: string, matrix: Matrix | undefined): number {
    const [l1, a1, b1] = toLab(simulate(toLinear(a), matrix));
    const [l2, a2, b2] = toLab(simulate(toLinear(b), matrix));
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function leaf(tree: TokenTree, path: string): string | undefined {
    let cursor: string | TokenTree | undefined = tree;
    for (const segment of path.split('.')) {
        if (cursor === undefined || typeof cursor === 'string') return undefined;
        cursor = cursor[segment];
    }
    return typeof cursor === 'string' ? cursor : undefined;
}

/** The colour a token resolves to, following references to a literal */
function literal(tree: TokenTree, path: string): string {
    let value = leaf(tree, path);
    for (let step = 0; step < 8 && value !== undefined; step += 1) {
        const reference = /^\{([^}]+)\}$/.exec(value)?.[1];
        if (reference === undefined) return value;
        value = leaf(tree, reference);
    }
    throw new Error(`${path} does not resolve to a literal`);
}

function effective(mode: string): TokenTree {
    return mergeOverDefaults(composeOverlays(SHIPPED_OVERLAYS, { mode }));
}

function dataLeaves(tree: TokenTree): { path: string; value: string }[] {
    return flattenTokens(tree)
        .filter((entry) => entry.path.startsWith('color.data.'))
        .map((entry) => ({ path: entry.path, value: entry.value ?? '' }));
}

describe('data visualisation tokens', () => {
    it('should add the 22 semantic color tokens to the default tree, each a reference to a palette primitive', () => {
        // Act
        const leaves = DEFAULT_LEAVES.filter((entry) => entry.path.startsWith('color.data.'));

        // Assert
        expect(leaves.map((entry) => entry.path)).toEqual(DATA_PATHS);
        for (const entry of leaves) {
            expect(entry.layer, entry.path).toBe('semantic');
            expect(entry.type, entry.path).toBe('color');
            expect(entry.value, entry.path).toMatch(/^\{palette\.(white|black|[a-z]+\.\d+)\}$/);
        }
        expect(validateReferences(DEFAULT_LEAVES)).toEqual([]);
    });

    it('should emit each token as a custom property of the color group', () => {
        // Act
        const names = DATA_PATHS.map((path) => cssName(path));

        // Assert
        expect(names[0]).toBe('--ui-color-data-categorical-1');
        expect(names).toContain('--ui-color-data-sequential-7');
        expect(names).toContain('--ui-color-data-diverging-neg3');
        expect(names).toContain('--ui-color-data-diverging-pos3');
        expect(DEFAULT_LEAVES.filter((entry) => entry.path.startsWith('color.data.')).map((entry) => entry.cssName)).toEqual(names);
        expect(DATA_PATHS.every((path) => tokenLayer(path) === 'semantic')).toBe(true);
    });

    it('should describe every token in one line', () => {
        // Assert
        for (const path of DATA_PATHS) {
            const description = DEFAULT_TOKEN_DESCRIPTIONS[path];
            expect(description, path).toBeTruthy();
            expect(description, path).not.toContain('\n');
        }
    });

    it('should let each mode overlay set the group and validate', () => {
        for (const mode of MODES) {
            // Arrange
            const overlay = SHIPPED_OVERLAYS.mode?.[mode]?.tokens as JsonObject;

            // Act
            const flat = dataLeaves(effective(mode));

            // Assert
            expect(validateTokens(overlay), mode).toEqual([]);
            expect(flat.map((entry) => entry.path), mode).toEqual(DATA_PATHS);
            expect(validateReferences(flattenTokens(effective(mode))), mode).toEqual([]);
        }
    });

    it('should make the light overlay equal the defaults and the dark and contrast overlays differ', () => {
        // Act
        const light = dataLeaves(effective('light'));
        const dark = dataLeaves(effective('dark'));
        const contrast = dataLeaves(effective('contrast'));

        // Assert
        expect(light).toEqual(dataLeaves(DEFAULT_TOKENS));
        for (const path of CATEGORICAL) {
            const base = light.find((entry) => entry.path === path)?.value;
            expect(dark.find((entry) => entry.path === path)?.value, path).not.toBe(base);
            expect(contrast.find((entry) => entry.path === path)?.value, path).not.toBe(base);
        }
    });

    it('should keep adjacent categorical colours distinguishable under protanopia, deuteranopia and tritanopia in each mode', () => {
        for (const mode of MODES) {
            const tree = effective(mode);
            for (const [name, matrix] of [['normal vision', undefined] as const, ...Object.entries(DEFICIENCIES)]) {
                for (let index = 0; index < CATEGORICAL.length - 1; index += 1) {
                    // Arrange
                    const first = CATEGORICAL[index] as string;
                    const second = CATEGORICAL[index + 1] as string;

                    // Act
                    const gap = distance(literal(tree, first), literal(tree, second), matrix);

                    // Assert
                    expect(gap, `${mode} ${name} ${first} and ${second}`).toBeGreaterThanOrEqual(MIN_DISTANCE);
                }
            }
        }
    });

    it('should meet 3:1 against the surface for every data colour in each mode', () => {
        for (const mode of MODES) {
            const tree = effective(mode);
            const surface = literal(tree, 'color.surface.base');
            for (const path of DATA_PATHS) {
                // Act
                const ratio = contrastRatio(literal(tree, path), surface);

                // Assert
                expect(ratio, `${mode} ${path}`).toBeGreaterThanOrEqual(MIN_DATA_CONTRAST);
            }
            expect(checkContrast(tree), mode).toEqual([]);
        }
    });

    it('should raise contrast with each sequential step in each mode', () => {
        for (const mode of MODES) {
            const tree = effective(mode);
            const surface = literal(tree, 'color.surface.base');
            const ratios = SEQUENTIAL.map((path) => contrastRatio(literal(tree, path), surface) as number);
            for (let index = 1; index < ratios.length; index += 1) {
                expect(ratios[index], `${mode} step ${index + 1}`).toBeGreaterThan(ratios[index - 1] as number);
            }
        }
    });

    it('should warn when a data colour has less than 3:1 against the surface', () => {
        // Arrange
        const tree = mergeOverDefaults({ color: { data: { categorical: { '3': '#dddddd' } } } });

        // Act
        const warnings = checkContrast(tree);

        // Assert
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({
            code: 'SUI-THEME-CONTRAST',
            severity: 'warning',
            statePath: '$.theme.tokens.color.data.categorical.3'
        });
        expect(warnings[0]?.message).toContain('$.theme.tokens.color.surface.base');
        expect(warnings[0]?.message).toContain('below 3:1');
    });
});
