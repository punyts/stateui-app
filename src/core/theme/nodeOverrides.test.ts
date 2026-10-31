import { describe, expect, it } from 'vitest';
import type { ComponentLibrary } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { AppDocument, Node } from '../types.js';
import { validateDocument } from '../validate/index.js';
import './documentValidator.js';

function shapeOf(file: string, source: Record<string, unknown>) {
    const result = parseShape({ summary: 'Fixture', ...source }, file);
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const library: ComponentLibrary = {
    panel: { tier: 'root', tag: 'x-panel', shape: shapeOf('panel.state.json', { properties: { children: { type: 'map', items: 'string', default: {} } } }) },
    button: {
        tier: 'root',
        tag: 'x-button',
        shape: shapeOf('button.state.json', { tokens: { radius: '{radius.md}' } })
    }
};

function check(theme: unknown, nested = true, extra: Partial<AppDocument> = {}) {
    const inner = { component: 'button', theme } as unknown as Node;
    const app = nested ? { component: 'panel', children: { a: inner } } : inner;
    const errors = validateDocument({ app, ...extra } as AppDocument, library).errors;
    return errors.map((error) => [error.code, error.statePath]);
}

describe('node theme overrides', () => {
    it('should accept semantic, component and referencing overrides', () => {
        // Arrange
        const theme = { color: { accent: { base: '#00aa00', soft: '{color.success.base}' } }, button: { radius: '0' } };

        // Act / Assert
        expect(check(theme)).toEqual([]);
        expect(check({ radius: { md: '{radius.lg}' } })).toEqual([]);
    });

    it('should return SUI-THEME-LAYER for a primitive override in a nested node, naming the node', () => {
        // Arrange / Act
        const errors = validateDocument(
            {
                app: { component: 'panel', children: { a: { component: 'button', theme: { palette: { blue: { 600: '#fff' } } } } } }
            } as unknown as AppDocument,
            library
        ).errors;

        // Assert
        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-THEME-LAYER', '$.app.children.a.theme.palette.blue.600']
        ]);
        expect(errors[0]?.message).toContain('"button"');
        expect(errors[0]?.message).toContain('$.app.children.a');
        expect(check({ scale: { space: { 1: '1px' } } })[0]?.[0]).toBe('SUI-THEME-LAYER');
        expect(check({ font: { family: { sans: 'serif' } } })[0]?.[0]).toBe('SUI-THEME-LAYER');
    });

    it('should return SUI-THEME-TOKEN for an unknown path and a group', () => {
        // Arrange / Act / Assert
        expect(check({ nope: { x: '1px' } })).toEqual([['SUI-THEME-TOKEN', '$.app.children.a.theme.nope.x']]);
        expect(check({ color: 'red' })).toEqual([['SUI-THEME-TOKEN', '$.app.children.a.theme.color']]);
        expect(check({ 'color.accent': { base: '#fff' } })[0]?.[0]).toBe('SUI-THEME-TOKEN');
    });

    it('should return SUI-THEME-VALUE for a wrong type, a number and an injected value', () => {
        // Arrange / Act / Assert
        expect(check({ color: { accent: { base: 'url(x)' } } })).toEqual([
            ['SUI-THEME-VALUE', '$.app.children.a.theme.color.accent.base']
        ]);
        expect(check({ button: { radius: 'red' } })).toEqual([['SUI-THEME-VALUE', '$.app.children.a.theme.button.radius']]);
        expect(check({ button: { radius: 4 } })).toEqual([['SUI-THEME-VALUE', '$.app.children.a.theme.button.radius']]);
        expect(check({ color: { accent: { base: '{radius.md}' } } })[0]?.[0]).toBe('SUI-THEME-VALUE');
    });

    it('should return SUI-THEME-REF for an unknown target, a wrong direction and a cycle', () => {
        // Arrange / Act / Assert
        expect(check({ color: { accent: { base: '{color.nope.base}' } } })).toEqual([
            ['SUI-THEME-REF', '$.app.children.a.theme.color.accent.base']
        ]);
        expect(check({ color: { accent: { base: '{button.radius}' } } })[0]?.[0]).toBe('SUI-THEME-REF');
        expect(check({ button: { radius: '{palette.blue.600}' } })[0]?.[0]).toBe('SUI-THEME-REF');
        const cycle = check({ color: { accent: { base: '{color.success.base}' }, success: { base: '{color.accent.base}' } } });
        expect(cycle.map((entry) => entry[0])).toEqual(['SUI-THEME-REF']);
        expect(check({ color: { accent: { base: '{color.accent.base}' } } }).map((entry) => entry[0])).toEqual(['SUI-THEME-REF']);
    });

    it('should return SUI-DOC-TYPE when theme is not an object', () => {
        // Arrange / Act / Assert
        expect(check('red')).toEqual([['SUI-DOC-TYPE', '$.app.children.a.theme']]);
        expect(check(['x'])).toEqual([['SUI-DOC-TYPE', '$.app.children.a.theme']]);
    });

    it('should check the theme of the root node and of a composed tree', () => {
        // Arrange
        const composed = { card: { component: 'button', theme: { palette: { blue: { 600: '#fff' } } } } };

        // Act
        const root = check({ nope: { x: '1px' } }, false);
        const inComposed = check({}, true, { composed } as Partial<AppDocument>);

        // Assert
        expect(root).toEqual([['SUI-THEME-TOKEN', '$.app.theme.nope.x']]);
        expect(inComposed).toEqual([['SUI-THEME-LAYER', '$.composed.card.theme.palette.blue.600']]);
    });
});
