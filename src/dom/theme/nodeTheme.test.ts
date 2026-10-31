import { describe, expect, it } from 'vitest';
import { nodeThemeMapper } from './nodeTheme.js';

describe('nodeThemeMapper', () => {
    it('should name a semantic path as its custom property and turn references into var()', () => {
        // Arrange
        const mapper = nodeThemeMapper();

        // Act / Assert
        expect(mapper.property(['color', 'accent', 'base'])).toBe('--ui-color-accent-base');
        expect(mapper.value('{color.success.base}')).toBe('var(--ui-color-success-base)');
        expect(mapper.value('#fff')).toBe('#fff');
    });

    it('should skip primitive and unknown paths and accept a declared component token', () => {
        // Arrange
        const mapper = nodeThemeMapper([{ path: 'chip.radius', group: 'chip', type: 'dimension', default: '{radius.md}' }]);

        // Act / Assert
        expect(mapper.property(['palette', 'blue', '600'])).toBeUndefined();
        expect(mapper.property(['nope', 'x'])).toBeUndefined();
        expect(mapper.property(['chip', 'radius'])).toBe('--ui-chip-radius');
    });

    it('should write an injected value empty', () => {
        // Arrange / Act / Assert
        expect(nodeThemeMapper().value('red; background: url(x)')).toBe('');
    });
});
