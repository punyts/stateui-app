import { describe, expect, it } from 'vitest';
import type { ComponentLibrary } from '../resolve/index.js';
import type { AppDocument, JsonObject } from '../types.js';
import { validateDocument } from '../validate/index.js';
import { validateThemeTokens } from './documentValidator.js';

const library: ComponentLibrary = {};
const app = { component: 'ghost' } as AppDocument['app'];

function contextOf(theme: unknown) {
    return {
        document: { theme, app } as unknown as AppDocument,
        library,
        tree: { node: app, instances: {} }
    };
}

describe('validateThemeTokens', () => {
    it('should accept a document without a theme and one with a valid override', () => {
        // Arrange / Act
        const none = validateThemeTokens(contextOf(undefined));
        const valid = validateThemeTokens(contextOf({ tokens: { color: { accent: { base: '#ff0000' } } } }));

        // Assert
        expect(none).toEqual([]);
        expect(valid).toEqual([]);
    });

    it('should return SUI-THEME errors with the state path for an invalid token', () => {
        // Arrange
        const theme = { tokens: { color: { accent: { base: 'url(x)' } }, nope: { x: '1px' } } };

        // Act
        const errors = validateThemeTokens(contextOf(theme));

        // Assert
        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-THEME-VALUE', '$.theme.tokens.color.accent.base'],
            ['SUI-THEME-TOKEN', '$.theme.tokens.nope.x']
        ]);
    });

    it('should reject tokens and active of the wrong type', () => {
        // Arrange / Act
        const errors = validateThemeTokens(contextOf({ tokens: 'x', active: { mode: 1 } }));

        // Assert
        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-DOC-TYPE', '$.theme.tokens'],
            ['SUI-DOC-TYPE', '$.theme.active']
        ]);
    });

    it('should run inside validateDocument as the registered theme validator', () => {
        // Arrange
        const document = { theme: { tokens: { color: { accent: { base: 'red;' } } as JsonObject } }, app } as AppDocument;

        // Act
        const errors = validateDocument(document, library).errors;

        // Assert
        expect(errors.map((error) => error.code)).toContain('SUI-THEME-VALUE');
    });
});
