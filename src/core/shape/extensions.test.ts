import { describe, expect, it } from 'vitest';
import { parseShape, reflectedProperties, validateNode } from './index.js';
import type { Shape, ValidateContext } from './index.js';
import type { Node } from '../types.js';

const FILE = 'data/table/table.state.json';
const BASE = '$.app.children.t';

function shapeOf(properties: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'A test component', properties }, FILE);
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

function parseCodes(properties: Record<string, unknown>): string[] {
    return parseShape({ summary: 'x', properties }, FILE).errors.map((error) => error.code);
}

function check(shape: Shape, node: Record<string, unknown>, context?: ValidateContext) {
    return validateNode(shape, { component: 'test', ...node } as Node, BASE, context);
}

function paths(shape: Shape, node: Record<string, unknown>, context?: ValidateContext): string[] {
    return check(shape, node, context).map((error) => error.statePath ?? '');
}

const TABLE = shapeOf({
    columns: {
        type: 'map',
        items: {
            _title: { type: 'string', kind: 'content', required: true },
            field: { type: 'string' },
            align: { type: 'string', values: ['start', 'end'], default: 'start' },
            cell: { type: 'node', row: true }
        }
    },
    _errors: { type: 'map', items: 'string', kind: 'content' },
    options: { type: ['array', 'map'], items: 'string' }
});

describe('map properties', () => {
    it('should parse a map with a sub-shape, string items and several types', () => {
        expect(TABLE.properties.columns?.items).toMatchObject({ _title: { kind: 'content', required: true } });
        expect(TABLE.properties._errors).toMatchObject({ type: 'map', items: 'string', kind: 'content' });
        expect(TABLE.properties.options?.type).toEqual(['array', 'map']);
    });

    it('should require items on a map and refuse them on other types', () => {
        expect(parseCodes({ a: { type: 'map' } })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ a: { type: 'string', items: 'string' } })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ a: { type: 'map', items: {} } })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ a: { type: ['string', 'string'] } })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ a: { type: [] } })).toEqual(['SUI-BUILD-SHAPE']);
    });

    it('should require nested _ properties to be content and other nested properties not to be', () => {
        expect(parseCodes({ a: { type: 'map', items: { _title: { type: 'string' } } } })).toEqual(['SUI-BUILD-KIND']);
        expect(parseCodes({ a: { type: 'map', items: { title: { type: 'string', kind: 'content' } } } })).toEqual([
            'SUI-BUILD-KIND'
        ]);
        expect(parseCodes({ _a: { type: 'map', items: 'string' } })).toEqual(['SUI-BUILD-KIND']);
    });

    it('should report a map default that does not fit', () => {
        expect(parseCodes({ a: { type: 'map', items: 'string', default: { x: 1 } } })).toEqual(['SUI-BUILD-DEFAULT']);
        expect(parseCodes({ a: { type: 'map', items: 'string', default: { x: 'y' } } })).toEqual([]);
    });

    it('should accept valid maps and either type of a multi-type property', () => {
        const node = {
            columns: { total: { _title: 'Total', field: 'total', align: 'end' } },
            _errors: { required: 'Required' },
            options: ['a', 'b']
        };

        expect(check(TABLE, node)).toEqual([]);
        expect(check(TABLE, { ...node, options: { a: 'A' } })).toEqual([]);
    });

    it('should report violations inside maps with the full path including the key', () => {
        const errors = check(TABLE, {
            columns: { total: { field: 'total', align: 'middle', extra: 1 }, other: 'text' },
            _errors: { required: 3 },
            options: { a: 1 }
        });

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-STATE-INVALID', `${BASE}.columns.total.align`],
            ['SUI-STATE-UNKNOWN', `${BASE}.columns.total.extra`],
            ['SUI-STATE-REQUIRED', `${BASE}.columns.total._title`],
            ['SUI-STATE-INVALID', `${BASE}.columns.other`],
            ['SUI-STATE-INVALID', `${BASE}._errors.required`],
            ['SUI-STATE-INVALID', `${BASE}.options.a`]
        ]);
    });

    it('should report a value that is neither of the allowed types', () => {
        expect(paths(TABLE, { options: 'a' })).toEqual([`${BASE}.options`]);
    });
});

describe('requiredWhen', () => {
    const shape = shapeOf({
        decorative: { type: 'boolean', default: false },
        iconPosition: { type: 'string', values: ['start', 'only'], default: 'start' },
        _label: { type: 'string', kind: 'content', requiredWhen: { property: 'decorative', equals: false } },
        _title: { type: 'string', kind: 'content', requiredWhen: { property: 'iconPosition', notEquals: 'start' } }
    });

    it('should require the property when the condition holds, naming both properties', () => {
        const errors = check(shape, {});

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 'SUI-STATE-CONDITION', statePath: `${BASE}._label` });
        expect(errors[0]?.message).toContain('_label');
        expect(errors[0]?.message).toContain('decorative');
    });

    it('should not require it when the condition does not hold', () => {
        expect(check(shape, { decorative: true })).toEqual([]);
        expect(check(shape, { _label: 'Close' })).toEqual([]);
    });

    it('should require it for notEquals and accept it once given', () => {
        expect(paths(shape, { _label: 'x', iconPosition: 'only' })).toEqual([`${BASE}._title`]);
        expect(check(shape, { _label: 'x', iconPosition: 'only', _title: 'T' })).toEqual([]);
    });

    it('should skip the check when the other property or the property itself is linked', () => {
        expect(check(shape, { '<-decorative': '$.data.d' })).toEqual([]);
        expect(check(shape, { '<-_label': '$.data.l' })).toEqual([]);
    });

    it('should work inside map items', () => {
        const items = shapeOf({
            m: {
                type: 'map',
                items: {
                    kind: { type: 'string' },
                    alt: { type: 'string', requiredWhen: { property: 'kind', equals: 'image' } }
                }
            }
        });

        expect(paths(items, { m: { a: { kind: 'image' } } })).toEqual([`${BASE}.m.a.alt`]);
        expect(check(items, { m: { a: { kind: 'text' } } })).toEqual([]);
    });

    it('should refuse a malformed condition or an unknown sibling', () => {
        expect(parseCodes({ a: { type: 'string', requiredWhen: { property: 'b' } } })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ a: { type: 'string', requiredWhen: { property: 'b', equals: 1, notEquals: 2 } } })).toEqual([
            'SUI-BUILD-SHAPE'
        ]);
        expect(parseCodes({ a: { type: 'string', requiredWhen: { property: 'a', equals: 1 } } })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ a: { type: 'string', requiredWhen: { property: 'missing', equals: 1 } } })).toEqual([
            'SUI-BUILD-SHAPE'
        ]);
    });
});

describe('runtime and reflect', () => {
    const shape = shapeOf({
        error: { type: 'string', runtime: true, default: '' },
        width: { type: 'string', reflect: true, default: 'm' },
        disabled: { type: 'boolean', reflect: true, default: false },
        label: { type: 'string' }
    });

    it('should mark runtime properties and default the flags of the others', () => {
        expect(shape.properties.error).toMatchObject({ runtime: true });
        expect(shape.properties.label).toMatchObject({ runtime: false, reflect: false, row: false });
    });

    it('should report a node that sets a runtime property, by value or by link', () => {
        expect(check(shape, { error: 'bad' })).toEqual([
            expect.objectContaining({ code: 'SUI-STATE-RUNTIME', statePath: `${BASE}.error` })
        ]);
        expect(check(shape, { '<-error': '$.data.e' }).map((error) => error.code)).toEqual(['SUI-STATE-RUNTIME']);
        expect(check(shape, { width: 'l' })).toEqual([]);
    });

    it('should refuse a runtime property without a default, a required one and one inside map items', () => {
        expect(parseCodes({ a: { type: 'string', runtime: true } })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ a: { type: 'string', runtime: true, default: '', required: true } })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ a: { type: 'map', items: { b: { type: 'string', runtime: true, default: '' } } } })).toEqual([
            'SUI-BUILD-SHAPE'
        ]);
    });

    it('should list the reflected properties in shape order', () => {
        expect(reflectedProperties(shape)).toEqual(['width', 'disabled', 'hidden']);
        expect(reflectedProperties(shapeOf({}))).toEqual(['hidden']);
    });

    it('should refuse reflect on types that are not attribute values', () => {
        expect(parseCodes({ a: { type: 'node', reflect: true } })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ a: { type: 'array', reflect: true } })).toEqual(['SUI-BUILD-SHAPE']);
    });
});

describe('icon type', () => {
    const shape = shapeOf({
        icon: { type: 'icon', default: '' },
        items: { type: 'map', items: { icon: { type: 'icon' } } }
    });
    const context: ValidateContext = { isIconName: (name) => name === 'check' };

    it('should accept any lower-case name of letters, digits and dashes without a context', () => {
        expect(check(shape, { icon: 'arrow-left-2' })).toEqual([]);
        expect(check(shape, { icon: '' })).toEqual([]);
    });

    it('should refuse names outside that alphabet', () => {
        expect(check(shape, { icon: 'Arrow' }).map((error) => error.code)).toEqual(['SUI-STATE-INVALID']);
        expect(check(shape, { icon: 'a b' }).map((error) => error.code)).toEqual(['SUI-STATE-INVALID']);
        expect(check(shape, { icon: 3 }).map((error) => error.code)).toEqual(['SUI-STATE-INVALID']);
    });

    it('should accept a name the context accepts and reject one it rejects, with the state path', () => {
        expect(check(shape, { icon: 'check' }, context)).toEqual([]);
        expect(check(shape, { icon: 'nope' }, context)).toEqual([
            expect.objectContaining({ code: 'SUI-STATE-INVALID', statePath: `${BASE}.icon` })
        ]);
        expect(paths(shape, { items: { a: { icon: 'nope' } } }, context)).toEqual([`${BASE}.items.a.icon`]);
    });

    it('should not ask the context about the empty name', () => {
        expect(check(shape, { icon: '' }, context)).toEqual([]);
    });
});

describe('row templates', () => {
    const shape = shapeOf({
        row: { type: 'node', row: true },
        header: { type: 'node' },
        columns: { type: 'map', items: { cell: { type: 'node', row: true }, head: { type: 'node' } } },
        label: { type: 'string' }
    });
    const template = {
        component: 'text',
        '<-_text': '$row.name',
        on: { press: { command: 'set', target: '$row', value: '$row.id' } }
    };

    it('should accept $row inside a row property and a map field marked row', () => {
        expect(check(shape, { row: template })).toEqual([]);
        expect(check(shape, { columns: { a: { cell: template } } })).toEqual([]);
    });

    it('should report $row in a slot that is not a row property as SUI-LINK-ROW', () => {
        const errors = check(shape, { header: template, columns: { a: { head: template } } });

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-LINK-ROW', `${BASE}.header.<-_text`],
            ['SUI-LINK-ROW', `${BASE}.header.on.press.target`],
            ['SUI-LINK-ROW', `${BASE}.header.on.press.value`],
            ['SUI-LINK-ROW', `${BASE}.columns.a.head.<-_text`],
            ['SUI-LINK-ROW', `${BASE}.columns.a.head.on.press.target`],
            ['SUI-LINK-ROW', `${BASE}.columns.a.head.on.press.value`]
        ]);
    });

    it('should report $row on the node itself unless the caller says it is inside a row', () => {
        const node = { label: 'x', '<-label': '$row.name', on: { press: { command: 'delete', target: '$row' } } };

        expect(paths(shape, node)).toEqual([`${BASE}.<-label`, `${BASE}.on.press.target`]);
        expect(check(shape, node, { insideRow: true })).toEqual([]);
    });

    it('should not treat text that merely starts with $row as a reference', () => {
        expect(check(shape, { label: '$rows', '<-label': '$.data.rowset' })).toEqual([]);
    });

    it('should accept row only on node properties', () => {
        expect(parseCodes({ a: { type: 'string', row: true } })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ a: { type: 'map', items: { b: { type: 'string', row: true } } } })).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseCodes({ a: { type: 'map', items: { b: { type: 'node', row: true } } } })).toEqual([]);
    });
});
