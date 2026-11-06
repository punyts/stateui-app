import { describe, expect, it } from 'vitest';
import type { AppDocument, JsonObject } from '../../types.js';
import { validateTheme } from '../documentValidator.js';
import { DEFAULT_TOKENS } from '../defaults.js';
import { validateReferences } from '../references.js';
import { flattenTokens } from '../defaults.js';
import { mergeOverDefaults, validateTokens } from '../validate.js';
import {
    SHIPPED_OVERLAYS,
    buildOverlayCatalog,
    composeOverlays,
    mergeTokenTrees,
    validateThemeOverlay
} from './index.js';
import type { DocumentValidationContext } from '../../validate/types.js';

const codes = (errors: { code: string }[]): string[] => errors.map((error) => error.code);

function contextOf(document: Partial<AppDocument>): DocumentValidationContext {
    return { document: { app: { component: 'panel' }, ...document }, library: {}, tree: { node: { component: 'panel' }, instances: {} } } as unknown as DocumentValidationContext;
}

describe('shipped overlays', () => {
    it('should ship mode light, dark and contrast, brand default and motion full and reduced', () => {
        // Arrange
        const names = Object.fromEntries(Object.entries(SHIPPED_OVERLAYS).map(([kind, named]) => [kind, Object.keys(named)]));

        // Assert
        expect(names).toEqual({ mode: ['light', 'dark', 'contrast'], brand: ['default'], motion: ['full', 'reduced'] });
    });

    it('should pass validation with no warning for every shipped overlay', () => {
        for (const [kind, named] of Object.entries(SHIPPED_OVERLAYS)) {
            for (const [name, overlay] of Object.entries(named)) {
                // Act
                const errors = validateThemeOverlay(kind, overlay.tokens, { name });

                // Assert
                expect(errors, `${kind}/${name}`).toEqual([]);
            }
        }
    });

    it('should leave every mode overlay merged over the default tree with valid references and no contrast warning', () => {
        for (const [name, overlay] of Object.entries(SHIPPED_OVERLAYS.mode as Record<string, { tokens: JsonObject }>)) {
            // Act
            const merged = mergeOverDefaults(overlay.tokens);
            const errors = [...validateReferences(flattenTokens(merged)), ...validateTokens(overlay.tokens)];

            // Assert
            expect(errors, name).toEqual([]);
        }
    });

    it('should make light, default and full carry the default tree for their groups', () => {
        // Assert
        expect(SHIPPED_OVERLAYS.mode?.light?.tokens).toEqual({ color: DEFAULT_TOKENS.color, elevation: DEFAULT_TOKENS.elevation });
        expect(SHIPPED_OVERLAYS.motion?.full?.tokens).toEqual({ motion: DEFAULT_TOKENS.motion });
        const brand = SHIPPED_OVERLAYS.brand?.default?.tokens as Record<string, unknown>;
        expect(brand.palette).toEqual(DEFAULT_TOKENS.palette);
        expect(brand.radius).toEqual(DEFAULT_TOKENS.radius);
        expect(brand.icon).toEqual(DEFAULT_TOKENS.icon);
    });

    it('should set every duration to 0 in reduced', () => {
        // Arrange
        const merged = mergeOverDefaults(SHIPPED_OVERLAYS.motion?.reduced?.tokens as JsonObject) as unknown as { motion: { duration: Record<string, string> } };

        // Assert
        expect(Object.values(merged.motion.duration).map((value) => parseFloat(value))).toEqual([0, 0, 0]);
    });
});

describe('validateThemeOverlay', () => {
    it('should reject a mode overlay with a palette value, with the path', () => {
        // Act
        const errors = validateThemeOverlay('mode', { palette: { blue: { '600': '#000000' } } }, { name: 'x' });

        // Assert
        expect(codes(errors)).toEqual(['SUI-THEME-OVERLAY']);
        expect(errors[0]?.statePath).toBe('$.theme.tokens.palette.blue.600');
        expect(errors[0]?.message).toContain('palette.blue.600');
    });

    it('should allow font.family but not the rest of font for a brand overlay', () => {
        // Act
        const family = validateThemeOverlay('brand', { font: { family: { sans: 'Inter, sans-serif' } } });
        const size = validateThemeOverlay('brand', { font: { size: { '1': '12px' } } });

        // Assert
        expect(family).toEqual([]);
        expect(codes(size)).toEqual(['SUI-THEME-OVERLAY']);
    });

    it('should reject a motion overlay that sets a color and a brand overlay that sets a semantic role', () => {
        // Assert
        expect(codes(validateThemeOverlay('motion', { color: { focus: '#000000' } }))).toEqual(['SUI-THEME-OVERLAY']);
        expect(codes(validateThemeOverlay('brand', { color: { focus: '#000000' } }))).toEqual(['SUI-THEME-OVERLAY']);
    });

    it('should run the value checks on every value', () => {
        // Act
        const errors = validateThemeOverlay('brand', { radius: { sm: 'url(x)' } });

        // Assert
        expect(codes(errors)).toEqual(['SUI-THEME-VALUE']);
    });

    it('should warn about contrast in a mode overlay', () => {
        // Act
        const errors = validateThemeOverlay('mode', { color: { text: { base: '#cccccc' } } });

        // Assert
        expect(codes(errors)).toEqual(['SUI-THEME-CONTRAST']);
    });

    it('should reject an unknown kind', () => {
        // Assert
        expect(codes(validateThemeOverlay('density', {}))).toEqual(['SUI-THEME-OVERLAY']);
    });

    it('should report the path under the given state path', () => {
        // Act
        const errors = validateThemeOverlay('brand', { radius: { sm: 'url(x)' } }, { name: 'acme', statePath: '$.themes.acme.tokens' });

        // Assert
        expect(errors[0]?.statePath).toBe('$.themes.acme.tokens.radius.sm');
    });
});

describe('buildOverlayCatalog', () => {
    it('should add a valid document overlay after the shipped ones', () => {
        // Act
        const { overlays, errors } = buildOverlayCatalog({ acme: { kind: 'brand', tokens: { palette: { blue: { '600': '#112233' } } } } });

        // Assert
        expect(errors).toEqual([]);
        expect(Object.keys(overlays.brand ?? {})).toEqual(['default', 'acme']);
        expect(Object.keys(SHIPPED_OVERLAYS.brand ?? {})).toEqual(['default']);
    });

    it('should reject a name that clashes with a shipped brand or motion overlay', () => {
        // Act
        const { overlays, errors } = buildOverlayCatalog({ default: { kind: 'brand', tokens: {} }, reduced: { kind: 'motion', tokens: {} } });

        // Assert
        expect(codes(errors)).toEqual(['SUI-THEME-OVERLAY', 'SUI-THEME-OVERLAY']);
        expect(overlays.brand?.default).toBe(SHIPPED_OVERLAYS.brand?.default);
        expect(overlays.motion?.reduced).toBe(SHIPPED_OVERLAYS.motion?.reduced);
    });

    it('should let a mode overlay named like a shipped mode refine it, its tokens over the shipped ones', () => {
        // Act
        const { overlays, errors } = buildOverlayCatalog({ dark: { kind: 'mode', tokens: { color: { accent: { base: '{palette.amber.400}', on: '{palette.neutral.950}' } } } } });

        // Assert
        expect(errors).toEqual([]);
        const dark = overlays.mode?.dark?.tokens as { color: { accent: { base: string }; surface: unknown } };
        expect(dark.color.accent.base).toBe('{palette.amber.400}');
        expect(dark.color.surface).toEqual((SHIPPED_OVERLAYS.mode?.dark?.tokens as { color: { surface: unknown } }).color.surface);
        expect((SHIPPED_OVERLAYS.mode?.dark?.tokens as { color: { accent: { base: string } } }).color.accent.base).not.toBe('{palette.amber.400}');
        expect(Object.keys(overlays.mode ?? {})).toEqual(Object.keys(SHIPPED_OVERLAYS.mode ?? {}));
    });

    it('should check a refined mode with the shipped tokens it keeps, so a light accent passes on the shipped dark accent.on', () => {
        // Act
        const { errors } = buildOverlayCatalog({ dark: { kind: 'mode', tokens: { color: { accent: { base: '{palette.amber.400}' } } } } });

        // Assert
        expect(errors).toEqual([]);
    });

    it('should allow a shipped name for another kind', () => {
        // Act
        const { errors } = buildOverlayCatalog({ dark: { kind: 'brand', tokens: {} } });

        // Assert
        expect(errors).toEqual([]);
    });

    it('should reserve system for mode and motion', () => {
        // Act
        const { errors } = buildOverlayCatalog({ system: { kind: 'mode', tokens: {} } });

        // Assert
        expect(codes(errors)).toEqual(['SUI-THEME-OVERLAY']);
    });

    it('should leave out an overlay with an error, an unknown kind or tokens that are not a tree', () => {
        // Act
        const { overlays, errors } = buildOverlayCatalog({
            a: { kind: 'mode', tokens: { palette: { white: '#ffffff' } } },
            b: { kind: 'size', tokens: {} },
            c: { kind: 'brand', tokens: [] as unknown as JsonObject }
        });

        // Assert
        expect(codes(errors)).toEqual(['SUI-THEME-OVERLAY', 'SUI-THEME-OVERLAY', 'SUI-THEME-OVERLAY']);
        expect(Object.keys(overlays.mode ?? {})).toEqual(['light', 'dark', 'contrast']);
        expect(Object.keys(overlays.brand ?? {})).toEqual(['default']);
    });
});

describe('composeOverlays and mergeTokenTrees', () => {
    it('should merge sparse trees left to right without changing them', () => {
        // Arrange
        const first = { a: { b: '1', c: '2' } };
        const second = { a: { b: '3' } };

        // Act
        const merged = mergeTokenTrees(first, second);

        // Assert
        expect(merged).toEqual({ a: { b: '3', c: '2' } });
        expect(first).toEqual({ a: { b: '1', c: '2' } });
    });

    it('should compose the overlay of each kind and skip a name that is not there', () => {
        // Act
        const composed = composeOverlays(SHIPPED_OVERLAYS, { mode: 'dark', motion: 'reduced', brand: 'nothing' }) as Record<string, unknown>;

        // Assert
        expect(Object.keys(composed).sort()).toEqual(['color', 'elevation', 'motion']);
    });
});

describe('the theme document validator', () => {
    it('should accept shipped names, system and a valid themes map', () => {
        // Arrange
        const context = contextOf({
            theme: { active: { mode: 'system', brand: 'acme', motion: 'reduced' } },
            themes: { acme: { kind: 'brand', tokens: { radius: { sm: '2px' } } } }
        });

        // Act
        const errors = validateTheme(context);

        // Assert
        expect(errors).toEqual([]);
    });

    it('should report a clashing themes name and an unknown active name with their state paths', () => {
        // Arrange
        const context = contextOf({
            theme: { active: { mode: 'sepia', size: 'big' } },
            themes: { default: { kind: 'brand', tokens: {} } }
        });

        // Act
        const errors = validateTheme(context);

        // Assert
        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-THEME-OVERLAY', '$.themes.default'],
            ['SUI-THEME-OVERLAY', '$.theme.active.mode'],
            ['SUI-THEME-OVERLAY', '$.theme.active.size']
        ]);
    });

    it('should not accept system for the brand kind', () => {
        // Act
        const errors = validateTheme(contextOf({ theme: { active: { brand: 'system' } } }));

        // Assert
        expect(codes(errors)).toEqual(['SUI-THEME-OVERLAY']);
    });
});
