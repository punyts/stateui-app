import { describe, expect, it } from 'vitest';
import { COMPONENT_CATEGORIES, MAX_PATTERN_LENGTH, MAX_PURPOSE_LENGTH, MAX_SUMMARY_LENGTH, buildDefaults, checkPurposes, normalizePurpose, isSafeUrl, parseShape, validateNode } from './index.js';
import type { Shape } from './index.js';
import type { Node } from '../types.js';

const FILE = 'form/text-field/text-field.state.json';

function shapeOf(overrides: Record<string, unknown> = {}): Shape {
    const result = parseShape({ summary: 'A test component', ...overrides }, FILE);
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

function propertyShape(property: Record<string, unknown>, name = 'value'): Shape {
    return shapeOf({ properties: { [name]: property } });
}

function codes(shape: Shape, node: Record<string, unknown>): string[] {
    return validateNode(shape, { component: 'test', ...node } as Node, '$.app').map((error) => error.code);
}

function parseCodes(json: unknown): string[] {
    return parseShape(json, FILE).errors.map((error) => error.code);
}

const FULL = {
    summary: 'A text input with a label',
    layout: true,
    events: ['change', 'invalid'],
    commands: ['focus', 'clear'],
    properties: {
        _label: { type: 'string', kind: 'content', default: 'Label' },
        width: { type: 'string', values: ['s', 'm', 'l'], default: 'm' },
        value: { type: 'string', required: true },
        header: { type: 'node' },
        src: { type: 'url', default: '' }
    }
};

describe('parseShape', () => {
    it('should read the construct-style format when every key is used', () => {
        const result = parseShape(JSON.stringify(FULL), FILE);

        expect(result.errors).toEqual([]);
        expect(result.shape).toMatchObject({
            summary: 'A text input with a label',
            layout: true,
            events: ['change', 'invalid'],
            commands: ['focus', 'clear']
        });
        expect(Object.keys(result.shape?.properties ?? {})).toEqual(['_label', 'width', 'value', 'header', 'src', 'hidden']);
        expect(result.shape?.properties._label).toMatchObject({ kind: 'content', required: false });
        expect(result.shape?.properties.value?.required).toBe(true);
    });

    it('should default the optional keys when only a summary is given', () => {
        const shape = shapeOf();

        expect(shape).toEqual({ summary: 'A test component', properties: { hidden: expect.objectContaining({ type: 'boolean', reflect: true }) }, shared: [], events: [], commands: [], layout: false });
    });

    it('should report SUI-BUILD-SHAPE with the file when the text is not JSON or not an object', () => {
        const broken = parseShape('{ nope', FILE);
        const list = parseShape('[]', FILE);

        expect(broken.errors[0]).toMatchObject({ code: 'SUI-BUILD-SHAPE', file: FILE });
        expect(list.errors[0]).toMatchObject({ code: 'SUI-BUILD-SHAPE', file: FILE });
        expect(broken.shape).toBeUndefined();
    });

    it('should report an unknown top-level key with the file', () => {
        const result = parseShape({ summary: 'x', colour: 'red' }, FILE);

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-KEY', file: FILE });
        expect(result.errors[0]?.message).toContain('colour');
        expect(result.shape).toBeUndefined();
    });

    it('should report an unknown property key', () => {
        const result = parseShape({ summary: 'x', properties: { a: { type: 'string', shared: true } } }, FILE);

        expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-KEY', file: FILE });
    });

    it('should report every error and not just the first', () => {
        const result = parseShape({ colour: 1, properties: { a: { type: 'nope' } } }, FILE);

        expect(result.errors.map((error) => error.code)).toEqual(['SUI-BUILD-KEY', 'SUI-BUILD-SUMMARY', 'SUI-BUILD-SHAPE']);
    });

    it('should report a wrong JSON type for a key', () => {
        expect(parseCodes({ summary: 'x', layout: 'yes' })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ summary: 'x', properties: [] })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ summary: 'x', properties: { a: { type: 'string', required: 1 } } })).toEqual(['SUI-BUILD-SHAPE']);
    });

    it('should report an unknown type, a bad kind and an empty values list', () => {
        expect(parseCodes({ summary: 'x', properties: { a: { type: 'date' } } })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ summary: 'x', properties: { _a: { type: 'string', kind: 'hidden' } } })).toContain('SUI-BUILD-SHAPE');
        expect(parseCodes({ summary: 'x', properties: { a: { type: 'string', values: [] } } })).toEqual(['SUI-BUILD-SHAPE']);
    });

    it('should report a property without a type', () => {
        expect(parseCodes({ summary: 'x', properties: { a: {} } })).toEqual(['SUI-BUILD-SHAPE']);
    });

    describe('summary', () => {
        it('should be required', () => {
            const result = parseShape({}, FILE);

            expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-SUMMARY', file: FILE });
        });

        it.each([
            ['empty', ''],
            ['blank', '   '],
            ['two lines', 'one\ntwo'],
            ['too long', 'x'.repeat(MAX_SUMMARY_LENGTH + 1)],
            ['not a string', 4]
        ])('should reject a summary that is %s', (_label, summary) => {
            expect(parseCodes({ summary })).toEqual(['SUI-BUILD-SUMMARY']);
        });

        it('should accept exactly the maximum length', () => {
            expect(parseCodes({ summary: 'x'.repeat(MAX_SUMMARY_LENGTH) })).toEqual([]);
        });
    });

    describe('property names and kind', () => {
        it('should require kind content for a _ property', () => {
            expect(parseCodes({ summary: 'x', properties: { _label: { type: 'string' } } })).toEqual(['SUI-BUILD-KIND']);
        });

        it('should require a _ name for kind content', () => {
            const result = parseShape({ summary: 'x', properties: { label: { type: 'string', kind: 'content' } } }, FILE);

            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-KIND', file: FILE });
        });

        it.each(['<-value', '$value', '__value', 'two words', '1abc', 'layout', 'on', 'component', 'placement', 'theme'])(
            'should reject the property name %s',
            (name) => {
                const result = parseShape({ summary: 'x', properties: { [name]: { type: 'string' } } }, FILE);

                expect(result.errors).toHaveLength(1);
                expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-NAME', file: FILE });
            }
        );

        it('should allow a slot named children', () => {
            expect(parseCodes({ summary: 'x', properties: { children: { type: 'node' } } })).toEqual([]);
        });
    });

    describe('events and commands', () => {
        it.each([
            [['Change']],
            [['a b']],
            [['change', 'change']],
            [[1]]
        ])('should reject the event list %j', (events) => {
            expect(parseCodes({ summary: 'x', events })).toEqual(['SUI-BUILD-SHAPE']);
        });

        it('should reject a bad command list', () => {
            expect(parseCodes({ summary: 'x', commands: ['Focus'] })).toEqual(['SUI-BUILD-SHAPE']);
        });

        it('should accept commandValues that name a declared command and a map property', () => {
            // Arrange
            const input = {
                summary: 'x',
                commands: ['show'],
                commandValues: { show: 'messages' },
                properties: { messages: { type: 'map', items: 'string', default: {} } }
            };

            // Act
            const result = parseShape(input, 'x.state.json');

            // Assert
            expect(result.errors).toEqual([]);
            expect(result.shape?.commandValues).toEqual({ show: 'messages' });
        });

        it.each([
            [{ show: 'messages' }, [], { messages: { type: 'map', items: 'string', default: {} } }],
            [{ show: 'label' }, ['show'], { label: { type: 'string', default: '' } }],
            [{ show: 'missing' }, ['show'], {}],
            [{ show: 1 }, ['show'], { messages: { type: 'map', items: 'string', default: {} } }],
            [{}, ['show'], {}]
        ])('should reject commandValues %j with commands %j', (commandValues, commands, properties) => {
            expect(parseCodes({ summary: 'x', commands, commandValues, properties })).toEqual(['SUI-BUILD-SHAPE']);
        });
    });

    describe('validators', () => {
        it('should report an unknown validator with the file', () => {
            const result = parseShape({ summary: 'x', properties: { a: { type: 'string', validators: { email: true } } } }, FILE);

            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-VALIDATOR', file: FILE });
            expect(result.errors[0]?.message).toContain('email');
        });

        it('should not treat inherited object names as validators', () => {
            expect(parseCodes({ summary: 'x', properties: { a: { type: 'string', validators: { toString: 1 } } } })).toEqual([
                'SUI-BUILD-VALIDATOR'
            ]);
        });

        it.each([
            ['oneOf', []],
            ['oneOf', 'a'],
            ['range', {}],
            ['range', { min: 5, max: 1 }],
            ['range', { low: 1 }],
            ['length', { min: -1 }],
            ['length', { min: 1.5 }]
        ])('should reject malformed %s options %j', (name, options) => {
            const type = name === 'range' ? 'number' : 'string';

            expect(parseCodes({ summary: 'x', properties: { a: { type, validators: { [name]: options } } } })).toEqual([
                'SUI-BUILD-SHAPE'
            ]);
        });

        it('should reject a validator that does not apply to the type', () => {
            expect(parseCodes({ summary: 'x', properties: { a: { type: 'boolean', validators: { pattern: 'a' } } } })).toEqual([
                'SUI-BUILD-SHAPE'
            ]);
            expect(parseCodes({ summary: 'x', properties: { a: { type: 'string', validators: { range: { min: 1 } } } } })).toEqual([
                'SUI-BUILD-SHAPE'
            ]);
        });

        it('should reject a pattern that is too long or does not compile', () => {
            const tooLong = 'a'.repeat(MAX_PATTERN_LENGTH + 1);

            expect(parseCodes({ summary: 'x', properties: { a: { type: 'string', validators: { pattern: tooLong } } } })).toEqual([
                'SUI-BUILD-PATTERN'
            ]);
            expect(parseCodes({ summary: 'x', properties: { a: { type: 'string', validators: { pattern: '(' } } } })).toEqual([
                'SUI-BUILD-PATTERN'
            ]);
        });

        it('should accept a pattern of exactly the maximum length', () => {
            const pattern = 'a'.repeat(MAX_PATTERN_LENGTH);

            expect(parseCodes({ summary: 'x', properties: { a: { type: 'string', validators: { pattern } } } })).toEqual([]);
        });
    });

    describe('defaults in the shape', () => {
        it('should reject a default that does not fit the type', () => {
            const result = parseShape({ summary: 'x', properties: { a: { type: 'number', default: 'x' } } }, FILE);

            expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-DEFAULT', file: FILE });
        });

        it('should reject a default outside the allowed values', () => {
            expect(parseCodes({ summary: 'x', properties: { a: { type: 'string', values: ['a'], default: 'b' } } })).toEqual([
                'SUI-BUILD-DEFAULT'
            ]);
        });

        it('should reject a default that fails a validator', () => {
            expect(parseCodes({ summary: 'x', properties: { a: { type: 'number', default: 9, validators: { range: { max: 5 } } } } })).toEqual([
                'SUI-BUILD-DEFAULT'
            ]);
        });

        it('should reject an unsafe default URL', () => {
            expect(parseCodes({ summary: 'x', properties: { a: { type: 'url', default: 'https://example.com' } } })).toEqual([
                'SUI-BUILD-DEFAULT'
            ]);
        });

        it('should reject allowed values of the wrong type', () => {
            expect(parseCodes({ summary: 'x', properties: { a: { type: 'number', values: ['a'] } } })).toEqual(['SUI-BUILD-SHAPE']);
        });
    });
});

describe('buildDefaults', () => {
    it('should return every property default and omit properties without one', () => {
        const shape = shapeOf(FULL);

        expect(buildDefaults(shape)).toEqual({ _label: 'Label', width: 'm', src: '' });
    });

    it('should return an empty state for an empty shape', () => {
        expect(buildDefaults(shapeOf())).toEqual({});
    });

    it('should return copies that do not share references with the shape', () => {
        const shape = propertyShape({ type: 'object', default: { a: { b: 1 } } });

        const first = buildDefaults(shape);
        (first.value as { a: { b: number } }).a.b = 2;

        expect(buildDefaults(shape)).toEqual({ value: { a: { b: 1 } } });
    });

    it('should keep falsy defaults', () => {
        const shape = shapeOf({
            properties: { a: { type: 'boolean', default: false }, b: { type: 'number', default: 0 }, c: { type: 'string', default: '' } }
        });

        expect(buildDefaults(shape)).toEqual({ a: false, b: 0, c: '' });
    });
});

describe('validateNode', () => {
    const shape = shapeOf(FULL);

    it('should accept a node that fits its shape', () => {
        expect(validateNode(shape, { component: 'textField', value: 'a', width: 'l', _label: 'Name' }, '$.app')).toEqual([]);
    });

    it('should report a missing required property with the state path', () => {
        const errors = validateNode(shape, { component: 'textField' }, '$.app.form');

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            code: 'SUI-STATE-REQUIRED',
            statePath: '$.app.form.value',
            component: 'textField'
        });
    });

    it('should count a link as providing a required property', () => {
        expect(validateNode(shape, { component: 'textField', '<-value': '$.data.name' }, '$.app')).toEqual([]);
    });

    it('should report an unknown property', () => {
        const errors = validateNode(shape, { component: 'textField', value: 'a', colour: 'red' }, '$.app');

        expect(errors).toEqual([expect.objectContaining({ code: 'SUI-STATE-UNKNOWN', statePath: '$.app.colour' })]);
    });

    it('should report a link to a property the shape does not have', () => {
        expect(codes(shape, { value: 'a', '<-nope': '$.data.x' })).toEqual(['SUI-STATE-UNKNOWN']);
    });

    it('should report names with $ or __ prefix as SUI-NODE-NAME', () => {
        expect(codes(shape, { value: 'a', $x: 1, __y: 2 })).toEqual(['SUI-NODE-NAME', 'SUI-NODE-NAME']);
    });

    it('should leave the tree keys to the document checks', () => {
        expect(codes(shape, { value: 'a', children: {}, placement: {}, theme: 'x', on: {} })).toEqual([]);
    });

    it('should leave layout to the layout validator', () => {
        const flat = shapeOf({ properties: { value: { type: 'string' } } });

        expect(codes(shape, { value: 'a', layout: { type: 'grid' } })).toEqual([]);
        expect(codes(flat, { value: 'a', layout: { type: 'grid' } })).toEqual([]);
    });

    it.each([
        ['string', 5],
        ['number', 'x'],
        ['integer', 1.5],
        ['boolean', 'true'],
        ['array', {}],
        ['object', []],
        ['icon', 3],
        ['node', 'text'],
        ['node', { label: 'x' }],
        ['node', null],
        ['string', null]
    ])('should report a value of the wrong type for %s', (type, value) => {
        const typed = propertyShape({ type });

        expect(codes(typed, { value })).toEqual(['SUI-STATE-INVALID']);
    });

    it.each([
        ['string', 'a'],
        ['number', 1.5],
        ['integer', 2],
        ['boolean', false],
        ['array', []],
        ['object', {}],
        ['icon', 'home'],
        ['any', null],
        ['node', { component: 'text' }]
    ])('should accept a value of type %s', (type, value) => {
        expect(codes(propertyShape({ type }), { value })).toEqual([]);
    });

    it('should report the state path of an invalid property', () => {
        const errors = validateNode(shape, { component: 'textField', value: 5 }, '$.app.a');

        expect(errors[0]).toMatchObject({ code: 'SUI-STATE-INVALID', statePath: '$.app.a.value', component: 'textField' });
    });

    it('should report a value outside the allowed values', () => {
        expect(codes(shape, { value: 'a', width: 'xl' })).toEqual(['SUI-STATE-INVALID']);
    });

    it('should report a slot that holds something other than a node', () => {
        expect(codes(shape, { value: 'a', header: 'text' })).toEqual(['SUI-STATE-INVALID']);
        expect(codes(shape, { value: 'a', header: { component: 'text' } })).toEqual([]);
    });

    it('should not read inherited names as properties', () => {
        expect(codes(shape, { value: 'a', constructor: 1 })).toEqual(['SUI-STATE-UNKNOWN']);
    });

    describe('validators', () => {
        it('should check oneOf', () => {
            const typed = propertyShape({ type: 'string', validators: { oneOf: ['a', 'b'] } });

            expect(codes(typed, { value: 'a' })).toEqual([]);
            expect(codes(typed, { value: 'c' })).toEqual(['SUI-STATE-INVALID']);
        });

        it('should compare oneOf options as JSON values', () => {
            const typed = propertyShape({ type: 'object', validators: { oneOf: [{ a: 1 }] } });

            expect(codes(typed, { value: { a: 1 } })).toEqual([]);
            expect(codes(typed, { value: { a: 2 } })).toEqual(['SUI-STATE-INVALID']);
        });

        it('should check pattern', () => {
            const typed = propertyShape({ type: 'string', validators: { pattern: '^[A-Z]{2}\\d$' } });

            expect(codes(typed, { value: 'AB1' })).toEqual([]);
            expect(codes(typed, { value: 'ab1' })).toEqual(['SUI-STATE-INVALID']);
        });

        it('should check pattern on a url after the URL rule', () => {
            const typed = propertyShape({ type: 'url', validators: { pattern: '^data:' } });

            expect(codes(typed, { value: 'data:image/png;base64,AAAA' })).toEqual([]);
            expect(codes(typed, { value: '#top' })).toEqual(['SUI-STATE-INVALID']);
            expect(codes(typed, { value: 'https://example.com' })).toEqual(['SUI-STATE-INVALID']);
        });

        it('should fail a pattern check for a string over the input limit', () => {
            const typed = propertyShape({ type: 'string', validators: { pattern: '^a+$' } });

            expect(codes(typed, { value: 'a'.repeat(10001) })).toEqual(['SUI-STATE-INVALID']);
            expect(codes(typed, { value: 'a'.repeat(10000) })).toEqual([]);
        });

        it('should accept a value that is a short, compiling regular expression with the regex validator', () => {
            const typed = propertyShape({ type: 'string', default: '', validators: { regex: 120 } });

            expect(codes(typed, { value: '^[A-Z]{2}\\d$' })).toEqual([]);
            expect(codes(typed, { value: 'email' })).toEqual([]);
            expect(codes(typed, { value: '(a|b)+c' })).toEqual([]);
            expect(codes(typed, { value: '[(a+)+]' })).toEqual([]);
            expect(codes(typed, { value: '\\(a+\\)+' })).toEqual([]);
        });

        it.each(['(', '[a-', '(a+)+', '(a*)*', '(a+){2,}', '((a+)b)*', '(?:a+)+', 'x'.repeat(121)])(
            'should refuse %s with the regex validator',
            (value) => {
                const typed = propertyShape({ type: 'string', default: '', validators: { regex: 120 } });

                expect(codes(typed, { value })).toEqual(['SUI-STATE-INVALID']);
            }
        );

        it.each([0, 1.5, 201, 'a', {}])('should reject malformed regex options %j', (options) => {
            expect(parseCodes({ summary: 'x', properties: { a: { type: 'string', validators: { regex: options } } } })).toEqual([
                'SUI-BUILD-SHAPE'
            ]);
        });

        it('should reject the regex validator on a number', () => {
            expect(parseCodes({ summary: 'x', properties: { a: { type: 'number', validators: { regex: 10 } } } })).toEqual([
                'SUI-BUILD-SHAPE'
            ]);
        });

        it('should check range with both bounds inclusive', () => {
            const typed = propertyShape({ type: 'number', validators: { range: { min: 1, max: 5 } } });

            expect(codes(typed, { value: 1 })).toEqual([]);
            expect(codes(typed, { value: 5 })).toEqual([]);
            expect(codes(typed, { value: 0.9 })).toEqual(['SUI-STATE-INVALID']);
            expect(codes(typed, { value: 5.1 })).toEqual(['SUI-STATE-INVALID']);
        });

        it('should check range with one bound', () => {
            const typed = propertyShape({ type: 'integer', validators: { range: { min: 0 } } });

            expect(codes(typed, { value: 1000 })).toEqual([]);
            expect(codes(typed, { value: -1 })).toEqual(['SUI-STATE-INVALID']);
        });

        it('should check length on strings and arrays', () => {
            const text = propertyShape({ type: 'string', validators: { length: { min: 2, max: 3 } } });
            const list = propertyShape({ type: 'array', validators: { length: { max: 1 } } });

            expect(codes(text, { value: 'ab' })).toEqual([]);
            expect(codes(text, { value: 'a' })).toEqual(['SUI-STATE-INVALID']);
            expect(codes(text, { value: 'abcd' })).toEqual(['SUI-STATE-INVALID']);
            expect(codes(list, { value: [1] })).toEqual([]);
            expect(codes(list, { value: [1, 2] })).toEqual(['SUI-STATE-INVALID']);
        });

        it('should run every validator on a property', () => {
            const typed = propertyShape({ type: 'string', validators: { length: { max: 3 }, pattern: '^a' } });

            expect(codes(typed, { value: 'abc' })).toEqual([]);
            expect(codes(typed, { value: 'bcd' })).toEqual(['SUI-STATE-INVALID']);
            expect(codes(typed, { value: 'abcd' })).toEqual(['SUI-STATE-INVALID']);
        });
    });

    describe('URL-typed properties', () => {
        const typed = propertyShape({ type: 'url' }, 'src');

        it.each([
            '',
            '#section',
            '/orders/12',
            'orders/12',
            './a.png',
            '../a.png',
            '?q=1',
            'a/b:c',
            'data:image/png;base64,iVBORw0KGgo=',
            'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
            'DATA:image/PNG;base64,AAAA'
        ])('should accept %s', (value) => {
            expect(codes(typed, { src: value })).toEqual([]);
        });

        it.each([
            'https://example.com/a.png',
            'http://example.com',
            'javascript:alert(1)',
            'JavaScript:alert(1)',
            ' javascript:alert(1)',
            'java\tscript:alert(1)',
            'java\nscript:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'data:application/javascript,alert(1)',
            'data:image/png',
            '//example.com/a.png',
            '\\\\example.com',
            '/\\example.com',
            'mailto:a@b.c',
            'file:///etc/passwd',
            'blob:https://example.com/x',
            'vbscript:x',
            'a b'
        ])('should reject %j', (value) => {
            expect(codes(typed, { src: value })).toEqual(['SUI-STATE-INVALID']);
        });

        it('should reject a URL value that is not a string', () => {
            expect(codes(typed, { src: 5 })).toEqual(['SUI-STATE-INVALID']);
        });
    });
});

describe('isSafeUrl', () => {
    it('should accept a relative target with a colon after a slash', () => {
        expect(isSafeUrl('/a:b')).toBe(true);
    });

    it('should refuse a control character inside a data URL', () => {
        expect(isSafeUrl('data:image/png;base64,AA\nAA')).toBe(false);
    });
});

describe('childComponents', () => {
    it('should read the key on a shape and on a node property', () => {
        const shape = shapeOf({
            childComponents: ['disclosure'],
            properties: { footer: { type: 'node', childComponents: ['button', 'link'] } }
        });

        expect(shape.childComponents).toEqual(['disclosure']);
        expect(shape.properties.footer?.childComponents).toEqual(['button', 'link']);
    });

    it('should leave the key out when the shape does not declare it', () => {
        const shape = shapeOf({ properties: { footer: { type: 'node' } } });

        expect(shape.childComponents).toBeUndefined();
        expect(shape.properties.footer?.childComponents).toBeUndefined();
    });

    it.each([[[]], [['a', 'a']], [['Bad']], [[1]], ['disclosure']])('should reject the shape key %j', (value) => {
        expect(parseCodes({ summary: 'x', childComponents: value })).toEqual(['SUI-BUILD-SHAPE']);
    });

    it('should reject the key on a property that is not a node', () => {
        expect(parseCodes({ summary: 'x', properties: { title: { type: 'string', childComponents: ['a'] } } })).toEqual([
            'SUI-BUILD-SHAPE'
        ]);
    });

    it('should reject an invalid list on a node property', () => {
        expect(parseCodes({ summary: 'x', properties: { footer: { type: 'node', childComponents: [] } } })).toEqual(['SUI-BUILD-SHAPE']);
    });
});

describe('category and purposes', () => {
    const PURPOSES: readonly string[] = Object.freeze(['show a list of records', 'sort rows by a column', 'pick rows to act on']);

    it('should list the nine categories in index order', () => {
        expect(COMPONENT_CATEGORIES).toEqual(['layout', 'navigation', 'forms', 'data', 'feedback', 'overlays', 'content', 'conversation', 'graphics']);
    });

    it('should keep a known category and the purpose phrases on the shape', () => {
        const shape = shapeOf({ category: 'data', purposes: PURPOSES });

        expect(shape.category).toBe('data');
        expect(shape.purposes).toEqual(PURPOSES);
    });

    it('should leave both out when the file has neither', () => {
        const shape = shapeOf();

        expect(shape).not.toHaveProperty('category');
        expect(shape).not.toHaveProperty('purposes');
    });

    it.each([['an unknown name', 'tables'], ['a different case', 'Data'], ['not a string', 3]])('should report a category that is %s', (_label, category) => {
        const result = parseShape({ summary: 'x', category }, FILE);

        expect(result.errors.map((error) => error.code)).toEqual(['SUI-BUILD-CATEGORY']);
        expect(result.errors[0]?.message).toContain(COMPONENT_CATEGORIES.join(', '));
        expect(result.errors[0]?.file).toBe(FILE);
    });

    it.each([
        ['two phrases', PURPOSES.slice(0, 2)],
        ['nine phrases', Array.from({ length: 9 }, (_, index) => `purpose number ${index}`)],
        ['a phrase on two lines', [...PURPOSES.slice(0, 2), 'one\ntwo']],
        ['a phrase over the limit', [...PURPOSES.slice(0, 2), 'x'.repeat(MAX_PURPOSE_LENGTH + 1)]],
        ['an empty phrase', [...PURPOSES.slice(0, 2), '   ']],
        ['a phrase that is not a string', [...PURPOSES.slice(0, 2), 7]],
        ['not an array', 'show a list']
    ])('should report purposes with %s', (_label, purposes) => {
        expect(parseCodes({ summary: 'x', purposes })).toEqual(['SUI-BUILD-PURPOSES']);
    });

    it('should accept three and eight phrases and a phrase of exactly the limit', () => {
        const eight = Array.from({ length: 8 }, (_, index) => `purpose number ${index}`);

        expect(checkPurposes(PURPOSES)).toBeUndefined();
        expect(checkPurposes(eight)).toBeUndefined();
        expect(checkPurposes([...PURPOSES.slice(0, 2), 'x'.repeat(MAX_PURPOSE_LENGTH)])).toBeUndefined();
    });

    it('should say what is wrong', () => {
        expect(checkPurposes(PURPOSES.slice(0, 2))).toBe('must list 3 to 8 phrases, not 2');
        expect(checkPurposes([...PURPOSES.slice(0, 2), ''])).toBe('phrase 3 is empty');
    });

    it('should compare phrases lowercased, trimmed and with inner spaces collapsed', () => {
        expect(normalizePurpose('  Sort   Rows\tby a Column ')).toBe('sort rows by a column');
    });
});
