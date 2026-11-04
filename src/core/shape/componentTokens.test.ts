import { describe, expect, it } from 'vitest';
import { validateTokens } from '../theme/index.js';
import { collectComponentTokens, parseShape } from './index.js';
import type { Shape } from './index.js';

const BUTTON = {
    summary: 'A button',
    tokens: {
        radius: '{radius.md}',
        padding: { inline: '{space.inset.md}', block: '{space.inset.sm}' },
        font: '{text.label.size}'
    }
};

function parsed(json: unknown, file: string): Shape {
    const result = parseShape(json, file);
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

describe('tokens in a shape', () => {
    it('should parse the style spec button example into typed tokens under the component name', () => {
        // Arrange / Act
        const shape = parsed(BUTTON, 'atoms/button/button.state.json');

        // Assert
        expect(shape.tokens).toEqual([
            { path: 'button.radius', group: 'button', type: 'dimension', default: '{radius.md}' },
            { path: 'button.padding.inline', group: 'button', type: 'dimension', default: '{space.inset.md}' },
            { path: 'button.padding.block', group: 'button', type: 'dimension', default: '{space.inset.sm}' },
            { path: 'button.font', group: 'button', type: 'dimension', default: '{text.label.size}' }
        ]);
    });

    it('should infer a dimension from a calc of a dimension and a number', () => {
        // Arrange / Act
        const shape = parsed(
            { summary: 'x', tokenGroup: 'recordlist', tokens: { row: 'calc({size.control.md} * {density.factor})' } },
            'composites/record-list/record-list.state.json'
        );

        // Assert
        expect(shape.tokens).toEqual([
            { path: 'recordlist.row', group: 'recordlist', type: 'dimension', default: 'calc({size.control.md} * {density.factor})' }
        ]);
    });

    it('should infer an inset from two dimension references separated by a space', () => {
        // Arrange / Act
        const shape = parsed({ summary: 'x', tokens: { padding: '{space.inset.md} {space.inset.md}' } }, 'panel/panel.state.json');

        // Assert
        expect(shape.tokens).toEqual([{ path: 'panel.padding', group: 'panel', type: 'inset', default: '{space.inset.md} {space.inset.md}' }]);
    });

    it('should reject a space-separated default that mixes in a colour', () => {
        // Arrange / Act
        const result = parseShape({ summary: 'x', tokens: { padding: '{space.inset.md} {color.text.muted}' } }, 'panel.state.json');

        // Assert
        expect(result.errors.map((error) => error.code)).toEqual(['SUI-BUILD-TOKENDEF']);
    });

    it('should take the type of a colour reference', () => {
        // Arrange / Act
        const shape = parsed({ summary: 'x', tokens: { color: '{color.text.muted}' } }, 'term/term.state.json');

        // Assert
        expect(shape.tokens?.[0]?.type).toBe('color');
    });

    it('should reject a primitive reference', () => {
        // Arrange / Act
        const result = parseShape({ summary: 'x', tokens: { radius: '{scale.space.3}' } }, 'button.state.json');

        // Assert
        expect(result.errors).toEqual([expect.objectContaining({ code: 'SUI-BUILD-TOKENDEF', file: 'button.state.json' })]);
        expect(result.shape).toBeUndefined();
    });

    it('should reject a literal default, a component reference, an unknown reference and an injection', () => {
        for (const value of ['4px', '{button.radius}', '{radius.nope}', '{radius.md} url(x)']) {
            // Arrange / Act
            const result = parseShape({ summary: 'x', tokens: { radius: value } }, 'button.state.json');

            // Assert
            expect(result.errors.map((error) => error.code)).toEqual(['SUI-BUILD-TOKENDEF']);
        }
    });

    it('should reject a calc that mixes in a colour', () => {
        // Arrange / Act
        const result = parseShape({ summary: 'x', tokens: { gap: 'calc({color.text.muted} * 2)' } }, 'button.state.json');

        // Assert
        expect(result.errors.map((error) => error.code)).toEqual(['SUI-BUILD-TOKENDEF']);
    });

    it('should reject a token key that is not lower-case letters and digits', () => {
        // Arrange / Act
        const result = parseShape({ summary: 'x', tokens: { borderRadius: '{radius.md}' } }, 'button.state.json');

        // Assert
        expect(result.errors).toEqual([expect.objectContaining({ code: 'SUI-BUILD-NAME', file: 'button.state.json' })]);
    });

    it('should name the file when a camelCase component sets no tokenGroup', () => {
        // Arrange / Act
        const result = parseShape({ summary: 'x', tokens: { row: '{size.control.md}' } }, 'composites/record-list/record-list.state.json');

        // Assert
        expect(result.errors).toEqual([
            expect.objectContaining({
                code: 'SUI-BUILD-TOKENGROUP',
                file: 'composites/record-list/record-list.state.json',
                component: 'recordList'
            })
        ]);
    });

    it('should accept an explicit tokenGroup and reject one that is not a lower-case word or is a default group', () => {
        for (const group of ['Field', 'a-b', 'color', 'palette']) {
            // Arrange / Act
            const result = parseShape({ summary: 'x', tokenGroup: group, tokens: { gap: '{space.gap.md}' } }, 'input.state.json');

            // Assert
            expect(result.errors.map((error) => error.code)).toEqual(['SUI-BUILD-TOKENGROUP']);
        }
        const shape = parsed({ summary: 'x', tokenGroup: 'control', tokens: { gap: '{space.gap.md}' } }, 'input.state.json');
        expect(shape.tokens?.[0]?.path).toBe('control.gap');
    });

    it('should leave tokens absent when the shape declares none', () => {
        // Arrange / Act
        const shape = parsed({ summary: 'x' }, 'record-list.state.json');

        // Assert
        expect(shape.tokens).toBeUndefined();
    });

    it('should reject an empty tokens object and a non-string leaf', () => {
        expect(parseShape({ summary: 'x', tokens: {} }, 'a.state.json').errors).toHaveLength(1);
        expect(parseShape({ summary: 'x', tokens: { radius: 4 } }, 'a.state.json').errors[0]?.code).toBe('SUI-BUILD-SHAPE');
    });
});

describe('collectComponentTokens', () => {
    const field = (extra: Record<string, string> = {}): Shape =>
        parsed({ summary: 'x', tokenGroup: 'field', tokens: { gap: '{space.gap.md}', ...extra } }, 'field.state.json');

    it('should return the tokens of every shape sorted by path', () => {
        // Arrange
        const sources = [
            { file: 'b.state.json', shape: parsed(BUTTON, 'button.state.json') },
            { file: 'c.state.json', shape: parsed({ summary: 'x', tokens: { gap: '{space.gap.md}' } }, 'card.state.json') }
        ];

        // Act
        const result = collectComponentTokens(sources);

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.tokens.map((token) => token.path)).toEqual([
            'button.font',
            'button.padding.block',
            'button.padding.inline',
            'button.radius',
            'card.gap'
        ]);
    });

    it('should list a group shared by shapes with identical entries once', () => {
        // Arrange / Act
        const result = collectComponentTokens([
            { file: 'a.state.json', shape: field() },
            { file: 'b.state.json', shape: field() }
        ]);

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.tokens).toHaveLength(1);
    });

    it('should name both files when shapes of one group declare different entries', () => {
        // Arrange / Act
        const result = collectComponentTokens([
            { file: 'a.state.json', shape: field() },
            { file: 'b.state.json', shape: field({ pad: '{space.inset.md}' }) }
        ]);

        // Assert
        expect(result.errors.map((error) => [error.code, error.file])).toEqual([
            ['SUI-BUILD-TOKENCONFLICT', 'b.state.json'],
            ['SUI-BUILD-TOKENCONFLICT', 'a.state.json']
        ]);
        expect(result.errors[0]?.message).toContain('a.state.json');
        expect(result.tokens.map((token) => token.path)).toEqual(['field.gap']);
    });

    it('should report a different default for the same path as a conflict', () => {
        // Arrange
        const other = parsed({ summary: 'x', tokenGroup: 'field', tokens: { gap: '{space.gap.lg}' } }, 'field.state.json');

        // Act
        const result = collectComponentTokens([
            { file: 'a.state.json', shape: field() },
            { file: 'b.state.json', shape: other }
        ]);

        // Assert
        expect(result.errors).toHaveLength(2);
    });
});

describe('component tokens in the token lookup', () => {
    it('should accept a component token path and type once the shape declares it', () => {
        // Arrange
        const { tokens } = collectComponentTokens([{ file: 'b', shape: parsed(BUTTON, 'button.state.json') }]);

        // Act / Assert
        expect(validateTokens({ button: { radius: '0' } }).map((error) => error.code)).toEqual(['SUI-THEME-TOKEN']);
        expect(validateTokens({ button: { radius: '0' } }, { componentTokens: tokens })).toEqual([]);
        expect(validateTokens({ button: { radius: 'red' } }, { componentTokens: tokens })[0]?.code).toBe('SUI-THEME-VALUE');
    });
});
