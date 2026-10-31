import { describe, expect, it } from 'vitest';
import type { ComponentLibrary } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { JsonObject } from '../types.js';
import { extractBaseOverlay, isContentKey, validateLocaleOverlay } from './index.js';

function shapeOf(properties: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', properties }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const LIBRARY: ComponentLibrary = {
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({ _title: { type: 'string', kind: 'content', default: '' } }) },
    text: {
        tier: 'root',
        tag: 'ui-text',
        shape: shapeOf({
            _text: { type: 'string', kind: 'content', default: '' },
            _errors: { type: 'object', kind: 'content', default: {} },
            value: { type: 'string', default: '' }
        })
    },
    table: {
        tier: 'root',
        tag: 'ui-table',
        shape: shapeOf({
            columns: { type: 'map', items: { _title: { type: 'string', kind: 'content', default: '' }, field: { type: 'string', default: '' } }, default: {} }
        })
    }
};

const APP: JsonObject = {
    component: 'panel',
    _title: 'Orders',
    children: {
        name: { component: 'text', _text: 'Name', _errors: { required: 'Required', length: 'Too long' }, value: 'x' },
        list: {
            component: 'table',
            columns: { customer: { _title: 'Customer', field: 'customer' }, total: { _title: 'Total', field: 'total' } }
        },
        pick: { component: 'select', options: { a: { _label: 'Alpha', value: 'a' }, b: { _label: 'Beta', value: 'b' } } },
        tabs: { component: 'tabs', children: { one: { component: 'text', placement: { _tab: 'One', order: 1 }, _text: 'First' } } },
        press: { component: 'button', on: { press: [{ command: 'set', _note: 'ignored' }] } }
    }
};

describe('isContentKey', () => {
    it('should accept _ names and reject __ and a bare _', () => {
        // Arrange
        const keys = ['_title', '__proto__', '_', 'title'];

        // Act
        const result = keys.map(isContentKey);

        // Assert
        expect(result).toEqual([true, false, false, false]);
    });
});

describe('extractBaseOverlay', () => {
    it('should collect _ properties in nodes, keyed maps, placement and content maps', () => {
        // Arrange
        const tree = structuredClone(APP);

        // Act
        const overlay = extractBaseOverlay(tree, []);

        // Assert
        expect(overlay).toEqual({
            _title: 'Orders',
            children: {
                name: { _text: 'Name', _errors: { required: 'Required', length: 'Too long' } },
                list: { columns: { customer: { _title: 'Customer' }, total: { _title: 'Total' } } },
                pick: { options: { a: { _label: 'Alpha' }, b: { _label: 'Beta' } } },
                tabs: { children: { one: { placement: { _tab: 'One' }, _text: 'First' } } }
            }
        });
        expect(tree).toEqual(APP);
    });

    it('should skip linked properties and linked entries of a content map', () => {
        // Arrange
        const tree = structuredClone(APP) as { children: { name: JsonObject; pick: { options: { a: JsonObject } } } };
        delete tree.children.name._text;
        delete (tree.children.name._errors as JsonObject).length;
        delete tree.children.pick.options.a._label;
        const linked = ['$.app.children.name._text', '$.app.children.name._errors.length', '$.app.children.pick.options.a._label'];

        // Act
        const overlay = extractBaseOverlay(tree, linked);
        const skipped = extractBaseOverlay(structuredClone(APP), linked);

        // Assert
        expect(overlay.children).toMatchObject({ name: { _errors: { required: 'Required' } }, pick: { options: { b: { _label: 'Beta' } } } });
        expect(JSON.stringify(overlay)).not.toContain('Alpha');
        expect(JSON.stringify(skipped)).not.toContain('Alpha');
        expect(JSON.stringify(skipped)).not.toContain('"Name"');
    });

    it('should leave out branches without content and the reserved __ prefix', () => {
        // Arrange
        const tree: JsonObject = { component: 'panel', children: { a: { component: 'text', value: 'x' } }, __hidden: 'no' };

        // Act
        const overlay = extractBaseOverlay(tree, []);

        // Assert
        expect(overlay).toEqual({});
    });

    it('should return a copy that shares nothing with the tree', () => {
        // Arrange
        const tree = structuredClone(APP);

        // Act
        const overlay = extractBaseOverlay(tree, []);
        ((tree.children as JsonObject).name as { _errors: JsonObject })._errors.required = 'Changed';

        // Assert
        expect(JSON.stringify(overlay)).toContain('Required');
    });

    it('should use the given root path for linked paths', () => {
        // Arrange
        const tree: JsonObject = { _title: 'T' };

        // Act
        const overlay = extractBaseOverlay(tree, ['$.app.children.x._title'], '$.app.children.x');

        // Assert
        expect(overlay).toEqual({});
    });
});

describe('validateLocaleOverlay', () => {
    const codes = (errors: { code: string }[]) => errors.map((error) => error.code);

    it('should accept content leaves, intermediate keys and content map entries that exist', () => {
        // Arrange
        const overlay: JsonObject = {
            _title: 'Aufträge',
            children: {
                name: { _text: 'Name', _errors: { required: 'Pflicht' } },
                list: { columns: { customer: { _title: 'Kunde' } } },
                pick: { options: { a: { _label: 'Alpha' } } },
                tabs: { children: { one: { placement: { _tab: 'Eins' } } } }
            }
        };

        // Act
        const errors = validateLocaleOverlay('de', overlay, APP, { library: LIBRARY });

        // Assert
        expect(errors).toEqual([]);
    });

    it('should reject a leaf that is not a _ property', () => {
        // Arrange
        const overlay: JsonObject = { children: { name: { value: 'y', component: 'text' } } };

        // Act
        const errors = validateLocaleOverlay('de', overlay, APP);

        // Assert
        expect(codes(errors)).toEqual(['SUI-LOCALE-CONTENT', 'SUI-LOCALE-CONTENT']);
        expect(errors[0]?.statePath).toBe('$.app.children.name.value');
        expect(errors[0]?.message).toContain('"de"');
        expect(errors[0]?.message).not.toContain('y"');
    });

    it('should reject a _ value that is not text or a map of text', () => {
        // Arrange
        const overlay: JsonObject = { _title: 4, children: { name: { _errors: { required: 1 } } } };

        // Act
        const errors = validateLocaleOverlay('de', overlay, APP);

        // Assert
        expect(errors.map((error) => error.statePath)).toEqual(['$.app._title', '$.app.children.name._errors.required']);
    });

    it('should reject a linked property and a linked content map entry', () => {
        // Arrange
        const app = structuredClone(APP);
        delete (app.children as { pick: { options: { a: JsonObject } } }).pick.options.a._label;
        const linkedPaths = ['$.app.children.pick.options.a._label', '$.app.children.name._errors.length'];
        const overlay: JsonObject = {
            children: { pick: { options: { a: { _label: 'Alpha' } } }, name: { _errors: { length: 'Lang' } } }
        };

        // Act
        const errors = validateLocaleOverlay('de', overlay, app, { linkedPaths });

        // Assert
        expect(errors.map((error) => error.statePath)).toEqual([
            '$.app.children.pick.options.a._label',
            '$.app.children.name._errors.length'
        ]);
        expect(codes(errors)).toEqual(['SUI-LOCALE-LINKED', 'SUI-LOCALE-LINKED']);
    });

    it('should reject a path that does not exist in the application', () => {
        // Arrange
        const overlay: JsonObject = {
            _subtitle: 'x',
            children: { ghost: { _text: 'Geist' }, name: { _errors: { missing: 'x' } }, list: { columns: { nope: { _title: 'x' } } } }
        };

        // Act
        const errors = validateLocaleOverlay('de', overlay, APP);

        // Assert
        expect(codes(errors)).toEqual(['SUI-LOCALE-PATH', 'SUI-LOCALE-PATH', 'SUI-LOCALE-PATH', 'SUI-LOCALE-PATH']);
        expect(errors.map((error) => error.statePath)).toContain('$.app.children.list.columns.nope');
    });

    it('should reject a nested object where the application has a plain value', () => {
        // Arrange
        const overlay: JsonObject = { children: { name: { value: { _x: 'y' } } } };

        // Act
        const errors = validateLocaleOverlay('de', overlay, APP);

        // Assert
        expect(codes(errors)).toEqual(['SUI-LOCALE-PATH']);
    });

    it('should check _ leaves against the shape, in nodes and map items', () => {
        // Arrange
        const app: JsonObject = {
            component: 'panel',
            _other: 'x',
            children: { list: { component: 'table', columns: { customer: { _title: 'C', _odd: 'x' } } } }
        };
        const overlay: JsonObject = {
            _other: 'y',
            children: { list: { columns: { customer: { _title: 'Kunde', _odd: 'x' } } } }
        };

        // Act
        const errors = validateLocaleOverlay('de', overlay, app, { library: LIBRARY });

        // Assert
        expect(errors.map((error) => error.statePath)).toEqual(['$.app._other', '$.app.children.list.columns.customer._odd']);
    });

    it('should not touch the overlay or the application', () => {
        // Arrange
        const overlay: JsonObject = { _title: 'Aufträge', children: { ghost: {} } };
        const copy = structuredClone(overlay);
        const app = structuredClone(APP);

        // Act
        validateLocaleOverlay('de', overlay, app);

        // Assert
        expect(overlay).toEqual(copy);
        expect(app).toEqual(APP);
    });
});
