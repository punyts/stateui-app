import { describe, expect, it } from 'vitest';
import { ARTICULATION_LISTS, SHARED_NAMES } from '../articulation/index.js';
import type { Node } from '../types.js';
import { buildDefaults, parseShape, reflectedProperties, validateNode } from './index.js';
import type { Shape } from './index.js';

const FILE = 'atoms/badge/badge.state.json';

function shapeOf(input: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'A badge', ...input }, FILE);
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

function errorsOf(input: Record<string, unknown>): { code: string; file?: string; message: string }[] {
    return parseShape({ summary: 'A badge', ...input }, FILE).errors;
}

function check(shape: Shape, node: Record<string, unknown>) {
    return validateNode(shape, { component: 'badge', ...node } as Node, '$.app');
}

const BADGE = shapeOf({
    properties: { _text: { type: 'string', kind: 'content', default: 'Badge' } },
    shared: { tone: { default: 'accent' }, size: {} }
});

describe('shared properties in parseShape', () => {
    it.each(SHARED_NAMES)('should expand %s with the closed list as its allowed values', (name) => {
        // Arrange and Act
        const shape = shapeOf({ shared: { [name]: {} } });

        // Assert
        expect(shape.shared).toEqual([name]);
        expect(shape.properties[name]).toMatchObject({ type: 'string', values: [...ARTICULATION_LISTS[name]], reflect: true, required: false });
        expect(shape.properties[name]?.default).toBeUndefined();
    });

    it('should carry the declared default and put the shared properties after the own ones', () => {
        // Assert
        expect(BADGE.shared).toEqual(['tone', 'size']);
        expect(Object.keys(BADGE.properties)).toEqual(['_text', 'tone', 'size', 'hidden']);
        expect(buildDefaults(BADGE)).toEqual({ _text: 'Badge', tone: 'accent' });
    });

    it('should add hidden to a shape that does not declare it', () => {
        // Arrange and Act
        const shape = shapeOf({});

        // Assert
        expect(shape.properties.hidden).toMatchObject({ type: 'boolean', reflect: true, required: false });
        expect(shape.shared).toEqual([]);
    });

    it('should reflect the shared names, hidden and the properties marked reflect', () => {
        // Arrange
        const shape = shapeOf({
            properties: { checked: { type: 'boolean', reflect: true }, label: { type: 'string' } },
            shared: { size: {}, tone: {} }
        });

        // Act and Assert
        expect(reflectedProperties(shape)).toEqual(['checked', 'size', 'tone', 'hidden']);
    });

    it('should report an unknown shared name with the file', () => {
        // Act
        const errors = errorsOf({ shared: { colour: {} } });

        // Assert
        expect(errors).toEqual([expect.objectContaining({ code: 'SUI-BUILD-SHAPE', file: FILE })]);
        expect(errors[0]?.message).toContain('shared.colour');
    });

    it('should not let a shape declare hidden', () => {
        expect(errorsOf({ shared: { hidden: {} } })).toEqual([expect.objectContaining({ code: 'SUI-BUILD-SHAPE', file: FILE })]);
    });

    it('should report a default outside the list, an unknown entry key and an entry that is not an object', () => {
        expect(errorsOf({ shared: { tone: { default: 'purple' } } })).toEqual([
            expect.objectContaining({ code: 'SUI-BUILD-DEFAULT', file: FILE })
        ]);
        expect(errorsOf({ shared: { tone: { values: ['a'] } } })).toEqual([expect.objectContaining({ code: 'SUI-BUILD-KEY', file: FILE })]);
        expect(errorsOf({ shared: { tone: 'accent' } })).toEqual([expect.objectContaining({ code: 'SUI-BUILD-SHAPE', file: FILE })]);
        expect(errorsOf({ shared: ['tone'] })).toEqual([expect.objectContaining({ code: 'SUI-BUILD-SHAPE', file: FILE })]);
    });

    it.each(['size', 'tone', 'variant', 'density', 'elevation', 'textRole', 'hidden'])(
        'should reject an own property named %s and name it in the error',
        (name) => {
            // Act
            const errors = errorsOf({ properties: { [name]: { type: 'string', values: ['narrow', 'wide'] } } });

            // Assert
            expect(errors).toEqual([expect.objectContaining({ code: 'SUI-BUILD-SHAPE', file: FILE })]);
            expect(errors[0]?.message).toContain(`properties.${name}`);
        }
    );

    it('should report an own size once even when the shape also declares shared size', () => {
        // Act
        const errors = errorsOf({ properties: { size: { type: 'string' } }, shared: { size: {} } });

        // Assert
        expect(errors).toHaveLength(1);
    });

    it('should accept a component-specific choice under another name', () => {
        // Arrange and Act
        const shape = shapeOf({ properties: { width: { type: 'string', values: ['narrow', 'wide'] } }, shared: { size: {} } });

        // Assert
        expect(shape.properties.width?.values).toEqual(['narrow', 'wide']);
        expect(shape.properties.size?.values).toEqual(['sm', 'md', 'lg']);
    });
});

describe('shared properties in validateNode', () => {
    it.each(SHARED_NAMES)('should accept every value of the %s list and reject one outside it', (name) => {
        // Arrange
        const shape = shapeOf({ shared: { [name]: {} } });

        // Act and Assert
        for (const value of ARTICULATION_LISTS[name]) expect(check(shape, { [name]: value })).toEqual([]);
        expect(check(shape, { [name]: 'nope' })).toEqual([
            expect.objectContaining({ code: 'SUI-STATE-INVALID', statePath: `$.app.${name}` })
        ]);
    });

    it('should return SUI-STATE for a shared property the component does not support', () => {
        // Act
        const errors = check(BADGE, { density: 'compact' });

        // Assert
        expect(errors).toEqual([
            expect.objectContaining({ code: 'SUI-STATE-SHARED', statePath: '$.app.density', component: 'badge' })
        ]);
        expect(errors[0]?.message).toContain('it supports');
    });

    it('should also reject a link to an unsupported shared property', () => {
        // Act
        const errors = check(BADGE, { '<-elevation': '$.data.e' });

        // Assert
        expect(errors).toEqual([expect.objectContaining({ code: 'SUI-STATE-SHARED' })]);
    });

    it('should accept hidden on a shape that does not declare it and reject a non-boolean', () => {
        // Arrange
        const shape = shapeOf({});

        // Act and Assert
        expect(check(shape, { hidden: true })).toEqual([]);
        expect(check(shape, { hidden: 'yes' })).toEqual([
            expect.objectContaining({ code: 'SUI-STATE-INVALID', statePath: '$.app.hidden' })
        ]);
    });

    it('should accept a component-specific width value that the closed size list would reject', () => {
        // Arrange
        const shape = shapeOf({ properties: { width: { type: 'string', values: ['narrow', 'wide'] } } });

        // Act and Assert
        expect(check(shape, { width: 'wide' })).toEqual([]);
        expect(check(shape, { size: 'sm' })).toEqual([expect.objectContaining({ code: 'SUI-STATE-SHARED' })]);
    });
});
