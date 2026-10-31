import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAVES } from '../../core/theme/index.js';
import { tokenSheet } from './rootSheet.js';

describe('tokenSheet', () => {
    it('should declare one bound custom property per default token leaf', () => {
        // Arrange
        const sheet = tokenSheet();

        // Act
        const declarations = sheet.split('\n').filter((line) => line.includes('{{'));

        // Assert
        expect(declarations).toHaveLength(DEFAULT_LEAVES.length);
        expect(sheet).toContain('--ui-color-text-muted: {{ cssValue($.theme.tokens.color.text.muted) }};');
        expect(sheet).toContain('--ui-palette-blue-600: {{ cssValue($.theme.tokens.palette.blue.600) }};');
    });

    it('should keep the host out of layout', () => {
        // Arrange / Act
        const sheet = tokenSheet();

        // Assert
        expect(sheet.startsWith(':host {\n    display: contents;')).toBe(true);
    });
});
