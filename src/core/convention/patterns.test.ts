import { describe, expect, it } from 'vitest';
import type { PatternPart } from '../blueprint/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { JsonObject } from '../types.js';
import { applyPattern, checkPattern, checkPatternPurposes, readPattern } from './index.js';

function shapeOf(input: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', ...input }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const LIBRARY: ComponentLibrary = Object.freeze({
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({ properties: { _title: { type: 'string', kind: 'content', default: '' } }, layout: true }) },
    text: { tier: 'root', tag: 'ui-text', shape: shapeOf({ properties: { _text: { type: 'string', kind: 'content', default: 'Text' } } }) },
    button: { tier: 'root', tag: 'ui-button', shape: shapeOf({ properties: { _title: { type: 'string', kind: 'content', default: 'Go' } }, events: ['press'] }) },
    list: { tier: 'root', tag: 'ui-list', shape: shapeOf({ properties: { items: { type: 'object', default: {} }, pageSize: { type: 'number', default: 10 } } }) },
    app: { tier: 'root', tag: 'ui-app', shape: shapeOf({ properties: {}, layout: true }) },
    grid: { tier: 'root', tag: 'ui-grid', shape: shapeOf({ properties: { records: { type: 'object' }, row: { type: 'node', row: true } } }) },
    menu: { tier: 'root', tag: 'ui-menu', shape: shapeOf({ properties: {}, layout: true, childComponents: ['button'] }) },
    card: { tier: 'composed', tree: { component: 'panel', children: { body: { component: 'text' } } } }
});

const FILE = 'patterns/screen/product-grid/product-grid.pattern.json';

const PURPOSES = Object.freeze(['show products in a grid', 'browse a catalog of items', 'list things for sale']);

/** A good screen pattern: a title written at two paths, a dataset path and a page size */
function screenJson(): JsonObject {
    return {
        summary: 'A grid of products with a heading',
        purposes: [...PURPOSES],
        tree: {
            component: 'panel',
            _title: 'Products',
            children: {
                heading: { component: 'text', _text: 'Products' },
                grid: { component: 'list', '<-items': '$.data.products', pageSize: 12 },
                actions: { component: 'panel' },
                more: { component: 'card' }
            }
        },
        slots: { actions: { path: 'children.actions', description: 'Buttons above the grid' } },
        params: {
            title: { type: 'string', default: 'Products', paths: ['_title', 'children.heading._text'], description: 'The heading' },
            products: { type: 'path', required: true, paths: ['children.grid.<-items'], description: 'The dataset of products' },
            pageSize: { type: 'number', default: 12, paths: ['children.grid.pageSize'], description: 'Products per page' }
        }
    };
}

/** A screen pattern with no slots or params */
function plainJson(): JsonObject {
    return {
        summary: 'A header over some text',
        purposes: ['top navigation bar', 'header with links over the content', 'frame a screen with a header'],
        tree: { component: 'panel', children: { header: { component: 'text', _text: 'App' }, body: { component: 'text' } } }
    };
}

function read(json: unknown): PatternPart {
    const result = readPattern(json, FILE, 'screen');
    expect(result.errors).toEqual([]);
    return result.pattern as PatternPart;
}

function problems(json: unknown): string[] {
    return readPattern(json, FILE, 'screen').errors.map((error) => `${error.code} ${error.message}`);
}

describe('readPattern', () => {
    it('should read a good screen pattern with its slots and params', () => {
        // Arrange and Act
        const pattern = read(screenJson());

        // Assert
        expect(pattern.kind).toBe('screen');
        expect(pattern.summary).toBe('A grid of products with a heading');
        expect(pattern.purposes).toEqual(PURPOSES);
        expect(pattern.slots).toEqual({ actions: { path: 'children.actions', description: 'Buttons above the grid' } });
        expect(pattern.params.products).toEqual({ type: 'path', required: true, paths: ['children.grid.<-items'], description: 'The dataset of products' });
        expect(pattern.params.title?.default).toBe('Products');
    });

    it('should read a pattern with no slots or params as empty maps', () => {
        // Arrange and Act
        const pattern = read(plainJson());

        // Assert
        expect(pattern.slots).toEqual({});
        expect(pattern.params).toEqual({});
    });

    it('should refuse a file that is not an object', () => {
        expect(problems(['tree'])).toEqual([`SUI-PATTERN-SHAPE Pattern ${FILE} is not valid at $: must be an object`]);
    });

    it.each([
        ['missing', undefined],
        ['multi-line', 'A grid\nof products'],
        ['too long', 'x'.repeat(121)]
    ])('should refuse a %s summary', (_label, summary) => {
        // Arrange
        const json = { ...screenJson(), summary } as JsonObject;

        // Act and Assert
        expect(problems(json)).toEqual([`SUI-PATTERN-SHAPE Pattern ${FILE} is not valid at $.summary: must be one line of at most 120 characters`]);
    });

    it('should refuse purposes that fail the phrase rules', () => {
        // Arrange
        const json = { ...screenJson(), purposes: ['only one phrase'] };

        // Act and Assert
        expect(problems(json)).toEqual([`SUI-PATTERN-SHAPE Pattern ${FILE} is not valid at $.purposes: must list 3 to 8 phrases, not 1`]);
    });

    it('should refuse a missing tree', () => {
        // Arrange
        const { tree: _tree, ...json } = screenJson();

        // Act and Assert
        expect(problems(json)).toContain(`SUI-PATTERN-SHAPE Pattern ${FILE} is not valid at $.tree: must be a node with a "component" name`);
    });

    it('should name the allowed keys for an unknown key', () => {
        expect(problems({ ...screenJson(), layout: 'grid' })).toEqual([
            `SUI-PATTERN-SHAPE Pattern ${FILE} is not valid at $.layout: unknown key (the keys here are "kind", "summary", "purposes", "tree", "slots", "params")`
        ]);
    });

    it('should refuse a kind in the file that is not the folder kind', () => {
        expect(problems({ ...screenJson(), kind: 'shell' })).toEqual([`SUI-PATTERN-SHAPE Pattern ${FILE} is not valid at $.kind: is "shell" but the folder is "screen"`]);
    });

    it.each([
        ['not an object', { actions: 'children.actions' }, '$.slots.actions: must be an object { path, description }'],
        ['without a path', { actions: { description: 'Buttons' } }, '$.slots.actions.path: must be a path in the tree, such as "children.main"'],
        ['without a description', { actions: { path: 'children.actions' } }, '$.slots.actions.description: must be one line of text']
    ])('should refuse a slot %s', (_label, slots, expected) => {
        expect(problems({ ...screenJson(), slots })).toEqual([`SUI-PATTERN-SHAPE Pattern ${FILE} is not valid at ${expected}`]);
    });

    it.each([
        ['of an unknown type', { type: 'date', default: 'x', paths: ['_title'], description: 'd' }, '$.params.p.type: must be one of "string", "number", "boolean", "path"'],
        ['with no paths', { type: 'string', default: 'x', paths: [], description: 'd' }, '$.params.p.paths: must list one or more paths in the tree'],
        ['with a default that does not fit', { type: 'number', default: 'twelve', paths: ['_title'], description: 'd' }, '$.params.p.default: does not fit the type "number"'],
        ['with a path default that is not a state path', { type: 'path', default: 'products', paths: ['_title'], description: 'd' }, '$.params.p.default: does not fit the type "path"'],
        ['with neither a default nor required', { type: 'string', paths: ['_title'], description: 'd' }, '$.params.p: needs a "default" or "required": true']
    ])('should refuse a param %s', (_label, param, expected) => {
        expect(problems({ ...screenJson(), params: { p: param } })).toEqual([`SUI-PATTERN-SHAPE Pattern ${FILE} is not valid at ${expected}`]);
    });
});

describe('checkPattern', () => {
    function check(json: JsonObject): string[] {
        return checkPattern(read(json), LIBRARY, FILE).map((error) => error.message);
    }

    it('should accept good screen patterns', () => {
        expect(check(screenJson())).toEqual([]);
        expect(check(plainJson())).toEqual([]);
    });

    it('should refuse a node whose component is not in the library', () => {
        // Arrange
        const json = screenJson();
        (json.tree as JsonObject).children = { hero: { component: 'carousel' } };

        // Act and Assert
        expect(check({ ...json, slots: {}, params: {} })).toEqual([`Pattern ${FILE} is not valid at $.tree.children.hero: component "carousel" is not in the library`]);
    });

    it('should refuse a node that fails its shape, and not open a composed node', () => {
        // Arrange
        const json = screenJson();
        ((json.tree as JsonObject).children as JsonObject).heading = { component: 'text', _text: 'Products', size: 'huge' };
        ((json.tree as JsonObject).children as JsonObject).more = { component: 'card', anything: 1 };

        // Act
        const messages = check(json);

        // Assert
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatch(/^Pattern .* is not valid at \$\.tree\.children\.heading\.size: SUI-STATE-[A-Z-]+: Property "size"/);
    });

    it('should refuse slot and param paths that do not resolve in the tree', () => {
        // Arrange
        const json = screenJson();
        json.slots = { actions: { path: 'children.nowhere.children', description: 'Buttons' } };
        (json.params as JsonObject).pageSize = { type: 'number', default: 12, paths: ['children.grid.perPage'], description: 'Per page' };

        // Act and Assert
        expect(check(json)).toEqual([
            `Pattern ${FILE} is not valid at $.slots.actions.path: "children.nowhere.children" does not resolve in the tree`,
            `Pattern ${FILE} is not valid at $.params.pageSize.paths.0: "children.grid.perPage" does not resolve in the tree`
        ]);
    });

    it('should refuse a screen that holds an app node', () => {
        // Arrange
        const json = screenJson();
        ((json.tree as JsonObject).children as JsonObject).inner = { component: 'app' };

        // Act and Assert
        expect(check(json)).toEqual([`Pattern ${FILE} is not valid at $.tree: a screen holds no "app" node; only $.app is one`]);
    });

    it('should accept $row inside a row template, also in its children, and refuse it outside', () => {
        // Arrange
        const row = { component: 'panel', '<-_title': '$row.title', children: { name: { component: 'text', '<-_text': '$row.name' } } };
        const inside = { ...screenJson(), slots: {}, params: {}, tree: { component: 'grid', '<-records': '$.data.items', row } };
        const outside = { ...screenJson(), slots: {}, params: {}, tree: { component: 'panel', children: { name: { component: 'text', '<-_text': '$row.name' } } } };

        // Act and Assert
        expect(check(inside)).toEqual([]);
        expect(check(outside)).toHaveLength(1);
        expect(check(outside)[0]).toMatch(/at \$\.tree\.children\.name\.<-_text: SUI-LINK-ROW: /);
    });

    it('should refuse a child the slot does not accept, naming the components it takes', () => {
        // Arrange
        const json = { ...screenJson(), slots: {}, params: {}, tree: { component: 'menu', children: { go: { component: 'button' }, note: { component: 'text' } } } };

        // Act and Assert
        expect(check(json)).toEqual([`Pattern ${FILE} is not valid at $.tree.children.note: component "text" is not accepted here; this slot takes "button"`]);
    });
});

describe('checkPatternPurposes', () => {
    it('should report a purpose two patterns share, compared as for components', () => {
        // Arrange
        const patterns = [
            { name: 'product-grid', file: 'a.pattern.json', purposes: ['Show products  in a grid', 'b', 'c'] },
            { name: 'dashboard', file: 'b.pattern.json', purposes: ['show products in a grid', 'd', 'e'] }
        ];

        // Act
        const errors = checkPatternPurposes(patterns);

        // Assert
        expect(errors.map((error) => [error.code, error.message])).toEqual([
            ['SUI-BUILD-PURPOSE-DUPLICATE', 'Purpose "Show products  in a grid" of product-grid in a.pattern.json repeats a purpose of dashboard']
        ]);
    });

    it('should accept patterns with distinct purposes', () => {
        expect(checkPatternPurposes([{ name: 'a', file: 'a', purposes: ['x', 'y', 'z'] }, { name: 'b', file: 'b', purposes: ['u', 'v', 'w'] }])).toEqual([]);
    });
});

describe('applyPattern', () => {
    function frozen(): PatternPart {
        const pattern = read(screenJson());
        return JSON.parse(JSON.stringify(pattern), (_key, value: unknown) => (typeof value === 'object' && value !== null ? Object.freeze(value) : value)) as PatternPart;
    }

    it('should write one value at each of its paths and the defaults of the others, leaving the pattern unchanged', () => {
        // Arrange
        const pattern = frozen();

        // Act
        const result = applyPattern(pattern, { title: 'Plants', products: '$.data.plants' });

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.tree?._title).toBe('Plants');
        expect((result.tree?.children as JsonObject).heading).toEqual({ component: 'text', _text: 'Plants' });
        expect((result.tree?.children as JsonObject).grid).toEqual({ component: 'list', '<-items': '$.data.plants', pageSize: 12 });
        expect(result.slots).toEqual([{ name: 'actions', path: 'children.actions', description: 'Buttons above the grid' }]);
        expect(pattern.tree._title).toBe('Products');
    });

    it('should refuse a missing required param', () => {
        // Arrange and Act
        const result = applyPattern(frozen(), { title: 'Plants' });

        // Assert
        expect(result.tree).toBeUndefined();
        expect(result.errors.map((error) => error.message)).toEqual(['Pattern param "products" is required (type "path")']);
    });

    it('should refuse an unknown param, naming the params there are', () => {
        // Arrange and Act
        const result = applyPattern(frozen(), { products: '$.data.plants', heading: 'Plants' });

        // Assert
        expect(result.errors.map((error) => [error.code, error.message])).toEqual([
            ['SUI-PATTERN-PARAM', 'Pattern param "heading" is not a param of this pattern (its params are "title", "products", "pageSize")']
        ]);
    });

    it('should refuse a value of the wrong type', () => {
        // Arrange and Act
        const result = applyPattern(frozen(), { products: '$.data.plants', pageSize: '12' });

        // Assert
        expect(result.errors.map((error) => error.message)).toEqual(['Pattern param "pageSize" must be of type "number"']);
    });
});
