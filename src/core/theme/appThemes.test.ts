import { describe, expect, it } from 'vitest';
import type { ComponentLibrary } from '../resolve/index.js';
import type { AppDocument, JsonObject } from '../types.js';
import { validateDocument } from '../validate/index.js';
import { activeAfterSwitch, startTheme, themeSource } from './appThemes.js';
import './index.js';
import { buildOverlayCatalog } from './overlays/catalog.js';

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

/** Two themes: \`sea\` with a night and a dusk mode and a bold brand, \`sand\` with only its own night */
const DOCUMENT = deepFreeze({
    app: { component: 'box' },
    theme: { tokens: { color: { accent: { base: '#0050a0' } } } },
    themes: {
        night: { kind: 'mode', tokens: { color: { surface: { base: '#101820' } } } },
        dusk: { kind: 'mode', tokens: { color: { surface: { base: '#303040' } } } },
        bold: { kind: 'brand', tokens: { palette: { neutral: { '50': '#fafaff' } } } }
    },
    appThemes: {
        sea: {
            tokens: { color: { accent: { base: '#0050a0' } } },
            overlays: {
                night: { kind: 'mode', tokens: { color: { surface: { base: '#101820' } } } },
                dusk: { kind: 'mode', tokens: { color: { surface: { base: '#303040' } } } },
                bold: { kind: 'brand', tokens: { palette: { neutral: { '50': '#fafaff' } } } }
            }
        },
        sand: { tokens: { color: { accent: { base: '#a05000' } } }, overlays: { night: { kind: 'mode', tokens: { color: { surface: { base: '#201810' } } } } } }
    }
}) as unknown as AppDocument;

const library = Object.freeze({ box: { tier: 'root', tag: 'x-box', shape: { properties: {}, events: [], commands: [] } } }) as unknown as ComponentLibrary;

function switchTo(name: string, active: Record<string, string>): Record<string, string> {
    const source = themeSource(DOCUMENT, name);
    return activeAfterSwitch(active, buildOverlayCatalog(source.overlays).overlays, source.overlays);
}

describe('startTheme and themeSource', () => {
    it('should start on the requested theme, then the document choice, then the first theme', () => {
        // Arrange
        const chosen = { ...DOCUMENT, theme: { ...DOCUMENT.theme, active: { theme: 'sand' } } };

        // Act, Assert
        expect(startTheme(DOCUMENT, 'sand')).toBe('sand');
        expect(startTheme(DOCUMENT, 'gone')).toBe('sea');
        expect(startTheme(chosen)).toBe('sand');
        expect(startTheme({ app: { component: 'box' } } as AppDocument)).toBeUndefined();
    });

    it('should give the named theme tokens and overlays, and the document own without one', () => {
        // Act
        const sand = themeSource(DOCUMENT, 'sand');
        const own = themeSource({ ...DOCUMENT, appThemes: undefined } as unknown as AppDocument, undefined);

        // Assert
        expect(sand.tokens).toEqual({ color: { accent: { base: '#a05000' } } });
        expect(Object.keys(sand.overlays ?? {})).toEqual(['night']);
        expect(own.tokens).toEqual(DOCUMENT.theme?.tokens);
        expect(Object.keys(own.overlays ?? {})).toEqual(['night', 'dusk', 'bold']);
    });
});

describe('activeAfterSwitch', () => {
    it('should keep a name the new theme has, shipped or its own, and keep system', () => {
        // Act
        const active = switchTo('sand', { mode: 'night', brand: 'default', motion: 'system' });

        // Assert
        expect(active).toEqual({ mode: 'night', brand: 'default', motion: 'system' });
    });

    it('should fall back to the new theme first own overlay of the kind', () => {
        // Act
        const active = switchTo('sand', { mode: 'dusk', brand: 'default', motion: 'full' });

        // Assert
        expect(active.mode).toBe('night');
    });

    it('should fall back to system for mode and motion and to the shipped default for brand when the theme has none of its own', () => {
        // Arrange
        const plain = { ...DOCUMENT, appThemes: { ...DOCUMENT.appThemes, plain: { tokens: {} } } } as unknown as AppDocument;
        const source = themeSource(plain, 'plain');

        // Act
        const active = activeAfterSwitch({ mode: 'dusk', brand: 'bold', motion: 'slow' }, buildOverlayCatalog(source.overlays).overlays, source.overlays);

        // Assert
        expect(active).toEqual({ mode: 'system', brand: 'default', motion: 'system' });
    });
});

describe('the theme validator with appThemes', () => {
    it('should accept a known theme in theme.active and look its overlay names up in that theme', () => {
        // Arrange
        const document = { ...DOCUMENT, theme: { ...DOCUMENT.theme, active: { theme: 'sand', mode: 'night' } } } as unknown as AppDocument;

        // Act
        const result = validateDocument(document, library);

        // Assert
        expect(result.errors.filter((error) => error.severity !== 'warning')).toEqual([]);
    });

    it('should refuse a theme the app does not list, naming the app themes', () => {
        // Arrange
        const document = { ...DOCUMENT, theme: { ...DOCUMENT.theme, active: { theme: 'forest' } } } as unknown as AppDocument;

        // Act
        const errors = validateDocument(document, library).errors.filter((error) => error.code === 'SUI-STATE-INVALID');

        // Assert
        expect(errors.map((error) => error.message)).toEqual([
            'Property "theme" at $.theme.active.theme does not fit the shape of "the app\'s themes (sea, sand)"'
        ]);
    });

    it('should report an overlay of a later theme at its own path', () => {
        // Arrange
        const appThemes = { ...DOCUMENT.appThemes, sand: { tokens: {}, overlays: { default: { kind: 'brand', tokens: {} } } } } as unknown as JsonObject;
        const document = { ...DOCUMENT, appThemes } as unknown as AppDocument;

        // Act
        const errors = validateDocument(document, library).errors.filter((error) => error.code === 'SUI-THEME-OVERLAY');

        // Assert
        expect(errors.map((error) => error.statePath)).toEqual(['$.appThemes.sand.overlays.default']);
    });
});
