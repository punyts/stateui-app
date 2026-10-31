import { createStore } from '@punyts/state';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOKENS, SHIPPED_OVERLAYS, buildOverlayCatalog, mergeOverDefaults } from '../../core/theme/index.js';
import type { JsonObject } from '../../core/types.js';
import { applyOverlay } from './applyOverlay.js';

function makeStore() {
    return createStore<{ theme: { tokens: JsonObject; active: Record<string, string> } }>({
        theme: { tokens: structuredClone(DEFAULT_TOKENS) as unknown as JsonObject, active: { mode: 'light', brand: 'default', motion: 'full' } }
    });
}

describe('applyOverlay', () => {
    it('should apply the sparse overlay and set the active name', () => {
        // Arrange
        const store = makeStore();

        // Act
        const errors = applyOverlay(store, 'mode', 'dark', SHIPPED_OVERLAYS);

        // Assert
        expect(errors).toEqual([]);
        expect(store.get('$.theme.active.mode')).toBe('dark');
        expect(store.get('$.theme.tokens.color.surface.base')).toBe('{palette.neutral.950}');
        expect(store.get('$.theme.tokens.palette.white')).toBe('#ffffff');
    });

    it('should return to the light state by applying light', () => {
        // Arrange
        const store = makeStore();
        const first: unknown = JSON.parse(JSON.stringify(store.get('$.theme.tokens')));

        // Act
        applyOverlay(store, 'mode', 'dark', SHIPPED_OVERLAYS);
        applyOverlay(store, 'mode', 'light', SHIPPED_OVERLAYS);

        // Assert
        expect(JSON.parse(JSON.stringify(store.get('$.theme.tokens')))).toEqual(first);
        expect(store.get('$.theme.active.mode')).toBe('light');
    });

    it('should change nothing for an unknown name or kind', () => {
        // Arrange
        const store = makeStore();
        const before = JSON.stringify(store.get('$.theme'));

        // Act
        const unknown = applyOverlay(store, 'mode', 'sepia', SHIPPED_OVERLAYS);
        const system = applyOverlay(store, 'mode', 'system', SHIPPED_OVERLAYS);
        const kind = applyOverlay(store, 'size', 'big', SHIPPED_OVERLAYS);

        // Assert
        expect([...unknown, ...system, ...kind].map((error) => error.code)).toEqual(['SUI-THEME-OVERLAY', 'SUI-THEME-OVERLAY', 'SUI-THEME-OVERLAY']);
        expect(JSON.stringify(store.get('$.theme'))).toBe(before);
    });

    it('should apply a document overlay and leave the overlay unchanged', () => {
        // Arrange
        const store = makeStore();
        const { overlays } = buildOverlayCatalog({ acme: { kind: 'brand', tokens: { palette: { blue: { '600': '#112233' } } } } });

        // Act
        applyOverlay(store, 'brand', 'acme', overlays);
        store.set('$.theme.tokens.palette.blue.600', '#000000');

        // Assert
        expect(store.get('$.theme.active.brand')).toBe('acme');
        expect(overlays.brand?.acme?.tokens).toEqual({ palette: { blue: { '600': '#112233' } } });
        expect(mergeOverDefaults({}).palette).toEqual(DEFAULT_TOKENS.palette);
    });
});
