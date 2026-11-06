import { describe, expect, it } from 'vitest';
import { MAX_COLOR_LENGTH, MAX_PATH_COMMANDS, MAX_PATH_DATA_LENGTH, MAX_POINTS, VALIDATORS, colorForm, parseShape, validateNode } from './index.js';
import type { Shape } from './index.js';
import type { JsonValue, Node } from '../types.js';

const FILE = 'atoms/test-shape/test-shape.state.json';

/** A shape with one property `value` of the type and validators given */
function shapeWith(type: unknown, validators: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'A test shape', properties: { value: { type, validators } } }, FILE);
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

/** True when a node with this `value` passes the shape */
function passes(shape: Shape, value: JsonValue): boolean {
    return validateNode(shape, { component: 'testShape', value } as Node, '$.app').length === 0;
}

const UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('graphics validators', () => {
    it('should report a refused value as SUI-STATE-INVALID at the property state path', () => {
        const shape = shapeWith('string', { pathData: true });

        const errors = validateNode(shape, { component: 'testShape', value: 'M 0 0 L x' }, '$.app.children.curve');

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 'SUI-STATE-INVALID', statePath: '$.app.children.curve.value' });
    });

    describe('color', () => {
        const shape = shapeWith('string', { color: true });

        it.each([
            '#fff',
            '#ffff',
            '#a1b2c3',
            '#A1B2C380',
            'rgb(10, 20, 30)',
            'rgba(10, 20, 30, 0.5)',
            'rgb(10 20 30 / 50%)',
            'hsl(210, 50%, 40%)',
            'hsla(210deg, 50%, 40%, 0.2)',
            '{color.accent.base}',
            '{chart.series.1}',
            'brandFade',
            'sky-gradient_2',
            'transparent'
        ])('should accept %s', (value) => {
            expect(passes(shape, value)).toBe(true);
        });

        it.each([
            '',
            '#ff',
            '#fffff',
            '#ggg',
            'rgb(10, 20)',
            'cmyk(1, 2, 3, 4)',
            'rgb(a, b, c)',
            '{color}',
            '{Color.Accent}',
            '{color.accent',
            'BrandFade',
            '2fade',
            'red fade',
            'url(#x)',
            'var(--ui-x)'
        ])('should refuse %j', (value) => {
            expect(passes(shape, value)).toBe(false);
        });

        it('should refuse a value over the length limit', () => {
            const name = 'a'.repeat(MAX_COLOR_LENGTH);

            expect(passes(shape, name)).toBe(true);
            expect(passes(shape, `${name}a`)).toBe(false);
        });

        it.each([
            ['#a1b2c3', 'literal'],
            ['hsl(210, 50%, 40%)', 'literal'],
            ['transparent', 'literal'],
            ['{color.accent.base}', 'token'],
            ['brandFade', 'paint'],
            ['none', 'paint'],
            ['var(--ui-x)', undefined],
            ['', undefined],
            ['a'.repeat(MAX_COLOR_LENGTH + 1), undefined]
        ] as const)('should give %j the form %s', (value, form) => {
            expect(colorForm(value)).toBe(form);
        });
    });

    describe('pathData', () => {
        const shape = shapeWith('string', { pathData: true });

        it.each(['M0 0L10 10Z', 'm 1 1 h 5 v 5 z', 'M0 0 C 1 1 2 2 3 3 S 4 4 5 5 Q 6 6 7 7 T 8 8 A 1 1 0 0 1 9 9', 'M0 0a1 1 0 00.5.5'])(
            'should accept %j',
            (value) => {
                expect(passes(shape, value)).toBe(true);
            }
        );

        it.each(['', '   ', 'L 0 0', 'M 0 0 X', 'M 0', 'M NaN 0', 'M 0 0 A 1 1 0 2 1 5 5'])('should refuse %j', (value) => {
            expect(passes(shape, value)).toBe(false);
        });

        it('should refuse path data over the character limit', () => {
            const head = 'M0 0';
            const atLimit = head + ' '.repeat(MAX_PATH_DATA_LENGTH - head.length);

            expect(passes(shape, atLimit)).toBe(true);
            expect(passes(shape, `${atLimit} `)).toBe(false);
        });

        it('should refuse path data over the command limit', () => {
            const atLimit = `M0 0${'h1'.repeat(MAX_PATH_COMMANDS - 1000)}${'z'.repeat(999)}`;

            expect(atLimit.length).toBeLessThanOrEqual(MAX_PATH_DATA_LENGTH);
            expect(passes(shape, atLimit)).toBe(true);
            expect(passes(shape, `${atLimit}Z`)).toBe(false);
        });
    });

    describe('points', () => {
        const shape = shapeWith('array', { points: true });

        it('should accept an empty list and pairs of finite numbers', () => {
            expect(passes(shape, [])).toBe(true);
            expect(passes(shape, [[0, 0], [1.5, -2], [1e3, 4]])).toBe(true);
        });

        it.each([[[[0]]], [[[0, 0, 0]]], [[['0', 0]]], [[[0, null]]], [[0, 0]], [[{ x: 0, y: 0 }]]])('should refuse %j', (value) => {
            expect(passes(shape, value)).toBe(false);
        });

        it('should refuse more pairs than the limit', () => {
            const atLimit = Array.from({ length: MAX_POINTS }, (_, index) => [index, index]);

            expect(passes(shape, atLimit)).toBe(true);
            expect(passes(shape, [...atLimit, [0, 0]])).toBe(false);
        });

        it('should combine with length for an exact count', () => {
            const line = shapeWith('array', { points: true, length: { min: 2, max: 2 } });

            expect(passes(line, [[0, 0], [1, 1]])).toBe(true);
            expect(passes(line, [[0, 0]])).toBe(false);
        });
    });

    describe('vector', () => {
        it('should take exactly the number of finite numbers its option names', () => {
            const two = shapeWith('array', { vector: 2 });
            const three = shapeWith('array', { vector: 3 });

            expect(passes(two, [1, 2])).toBe(true);
            expect(passes(two, [1, 2, 3])).toBe(false);
            expect(passes(three, [1, 2, 3])).toBe(true);
            expect(passes(three, [1, 2])).toBe(false);
            expect(passes(three, [1, '2', 3])).toBe(false);
            expect(passes(three, [])).toBe(false);
        });
    });

    describe('fields', () => {
        const shape = shapeWith('object', {
            fields: {
                x: { type: 'number', required: true },
                width: { type: 'number', required: true, validators: { range: { min: 0 } } },
                fit: { type: 'string', values: ['contain', 'cover'] },
                easing: { type: 'string', validators: { oneOf: ['linear', 'ease'] } },
                color: { type: 'string', validators: { color: true } },
                map: { type: 'object', validators: { fileRef: { types: ['image/png'] } } },
                offset: { type: 'array', validators: { vector: 2 } },
                loop: { type: 'boolean' },
                inner: { type: 'object', validators: { fields: { a: { type: 'string', required: true } } } }
            }
        });

        it('should accept an object with the required fields and fitting optional ones', () => {
            expect(passes(shape, { x: 0, width: 10 })).toBe(true);
            expect(
                passes(shape, {
                    x: -1,
                    width: 0,
                    fit: 'cover',
                    easing: 'ease',
                    color: '{color.accent.base}',
                    map: { id: UUID, name: 'wood.png', size: 10, type: 'image/png' },
                    offset: [1, 2],
                    loop: true,
                    inner: { a: 'b' }
                })
            ).toBe(true);
        });

        it.each([
            ['a key that is not listed', { x: 0, width: 1, height: 2 }],
            ['a missing required field', { x: 0 }],
            ['a field of the wrong type', { x: '0', width: 1 }],
            ['a number that is not finite (null)', { x: null, width: 1 }],
            ['a value outside the field values', { x: 0, width: 1, fit: 'stretch' }],
            ['a field that fails range', { x: 0, width: -1 }],
            ['a field that fails oneOf', { x: 0, width: 1, easing: 'bounce' }],
            ['a field that fails color', { x: 0, width: 1, color: '#12' }],
            ['a field that fails fileRef', { x: 0, width: 1, map: { id: 'x', name: 'a', size: 1, type: 'image/png' } }],
            ['a field that fails vector', { x: 0, width: 1, offset: [1] }],
            ['an object field that is an array', { x: 0, width: 1, inner: [] }],
            ['a nested field list that fails', { x: 0, width: 1, inner: {} }]
        ])('should refuse %s', (_, value) => {
            expect(passes(shape, value)).toBe(false);
        });
    });

    describe('fileRef', () => {
        const objects = shapeWith('object', { fileRef: { types: ['image/png', 'image/jpeg'] } });
        const either = shapeWith(['string', 'object'], { fileRef: { types: ['image/png', 'model/gltf-binary'], dataUrl: true } });
        const strings = shapeWith('string', { fileRef: { types: ['image/png'] } });

        it('should accept a file reference of a listed type', () => {
            expect(passes(objects, { id: UUID, name: 'a.png', size: 0, type: 'image/png' })).toBe(true);
            expect(passes(objects, { id: UUID.toUpperCase(), name: 'b.jpg', size: 2048, type: 'image/jpeg' })).toBe(true);
        });

        it.each([
            ['an id that is not a UUID', { id: 'abc', name: 'a.png', size: 0, type: 'image/png' }],
            ['a negative size', { id: UUID, name: 'a.png', size: -1, type: 'image/png' }],
            ['a size that is not an integer', { id: UUID, name: 'a.png', size: 1.5, type: 'image/png' }],
            ['a type that is not listed', { id: UUID, name: 'a.gif', size: 1, type: 'image/gif' }],
            ['a missing name', { id: UUID, size: 1, type: 'image/png' }],
            ['a name that is not a string', { id: UUID, name: 5, size: 1, type: 'image/png' }],
            ['an extra key', { id: UUID, name: 'a.png', size: 1, type: 'image/png', url: 'x' }]
        ])('should refuse %s', (_, value) => {
            expect(passes(objects, value)).toBe(false);
        });

        it('should accept a data URL of a listed image type only with dataUrl', () => {
            expect(passes(either, 'data:image/png;base64,iVBORw0KGgo=')).toBe(true);
            expect(passes(either, 'data:image/png,raw')).toBe(true);
            expect(passes(strings, 'data:image/png;base64,iVBORw0KGgo=')).toBe(false);
        });

        it.each([
            ['an image type that is not listed', 'data:image/gif;base64,R0lGOD=='],
            ['a listed type that is not an image', 'data:model/gltf-binary;base64,Z2xURg=='],
            ['a base64 body with stray characters', 'data:image/png;base64,iVBOR w0K'],
            ['a URL that is not a data URL', 'https://example.com/a.png'],
            ['a data URL without a comma', 'data:image/png;base64']
        ])('should refuse %s', (_, value) => {
            expect(passes(either, value)).toBe(false);
        });

        it('should still check a file reference on a property that is a string or an object', () => {
            expect(passes(either, { id: UUID, name: 'm.glb', size: 9, type: 'model/gltf-binary' })).toBe(true);
            expect(passes(either, { id: UUID, name: 'm.glb', size: 9, type: 'model/gltf' })).toBe(false);
        });
    });

    it('should pass a value of a type a graphics check does not apply to, for a property of several types', () => {
        const shape = shapeWith(['string', 'array'], { color: true, vector: 2 });

        expect(passes(shape, [1, 2])).toBe(true);
        expect(passes(shape, '#fff')).toBe(true);
        expect(passes(shape, [1])).toBe(false);
        expect(passes(shape, 'not a colour')).toBe(false);
        expect(VALIDATORS.color.check(5, true)).toBe(true);
        expect(VALIDATORS.points.check('x', true)).toBe(true);
        expect(VALIDATORS.fields.check([], { a: { type: 'number' } })).toBe(true);
    });
});
