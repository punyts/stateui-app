import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildError } from '../errors/index.js';
import { MAX_DEPTH, MAX_NODES } from '../limits.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { JsonObject, Node } from '../types.js';
import { documentValidators, libraryFromCatalog, registerDocumentValidator, validateDocument } from './index.js';

function shapeOf(properties: Record<string, unknown>, events: string[] = [], commands: string[] = [], layout = false): Shape {
    const result = parseShape({ summary: 'Test', properties, events, commands, layout }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const LIBRARY: ComponentLibrary = {
    text: {
        tier: 'root',
        tag: 'ui-text',
        shape: shapeOf({
            _value: { type: 'string', kind: 'content', default: '' },
            width: { type: 'string', default: 'm', values: ['s', 'm', 'l'] },
            label: { type: 'string', default: '' }
        })
    },
    button: {
        tier: 'root',
        tag: 'ui-button',
        shape: shapeOf({ _title: { type: 'string', kind: 'content', default: 'Go' }, pressed: { type: 'boolean', default: false } }, ['press'])
    },
    icon: { tier: 'root', tag: 'ui-icon', shape: shapeOf({ name: { type: 'icon', required: true } }) },
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({ title: { type: 'string', default: '' } }, [], [], true) },
    form: {
        tier: 'root',
        tag: 'ui-form',
        shape: shapeOf({ note: { type: 'string', default: '' }, name: { type: 'string', default: '' } }, ['submitted'], ['submit', 'reset'])
    },
    modal: {
        tier: 'root',
        tag: 'ui-modal',
        shape: shapeOf({ body: { type: 'node' }, footer: { type: 'node' } }, ['close'], ['open', 'close'])
    },
    records: {
        tier: 'root',
        tag: 'ui-records',
        shape: shapeOf({
            title: { type: 'string', default: '' },
            current: { type: 'any', runtime: true, exposed: true, default: {} },
            concealed: { type: 'any', runtime: true, default: {} },
            columns: {
                type: 'map',
                items: { cell: { type: 'node', row: true }, plain: { type: 'node' } },
                default: {}
            }
        })
    },
    list: {
        tier: 'root',
        tag: 'ui-list',
        shape: shapeOf({ rows: { type: 'array', default: [] }, row: { type: 'node', row: true } })
    },
    orderEditor: {
        tier: 'composed',
        tree: {
            component: 'modal',
            on: { close: { command: 'reset', target: '.body.children.form' } },
            body: { component: 'panel', children: { form: { component: 'form' } } },
            footer: {
                component: 'panel',
                children: {
                    save: { component: 'button', on: { press: { command: 'submit', target: '^orderEditor.body.children.form' } } },
                    cancel: { component: 'button', on: { press: { command: 'close', target: '$parent' } } }
                }
            }
        }
    }
};

const ORDERS_LIBRARY: ComponentLibrary = {
    ...LIBRARY,
    ordersTable: {
        tier: 'composed',
        tree: {
            component: 'panel',
            children: { table: { component: 'records', columns: { status: { plain: { component: 'text' } }, actions: { plain: { component: 'text' } } } } }
        }
    }
};

const registered: (() => void)[] = [];

afterEach(() => {
    while (registered.length > 0) (registered.pop() as () => void)();
});

function codes(document: unknown): string[] {
    return validateDocument(document, LIBRARY).errors.map((error) => error.code);
}

function doc(app: Node, extra: JsonObject = {}): JsonObject {
    return { app, ...extra };
}

describe('validateDocument', () => {
    it('should accept the order editor document', () => {
        const document = doc(
            {
                component: 'panel',
                children: {
                    title: { component: 'text', _value: 'Orders' },
                    editor: { component: 'orderEditor' },
                    name: { component: 'text', '<-_value': '$.data.order.name' },
                    list: { component: 'list', row: { component: 'text', '<-_value': '$row.name' } },
                    open: { component: 'button', on: { press: [{ command: 'set', target: '$.data.order.name', value: 'x' }] } }
                }
            },
            { data: { order: { name: 'A' } }, locale: 'en', theme: { tokens: {}, active: {} }, composed: {} }
        );

        const result = validateDocument(document, LIBRARY);

        expect(result).toEqual({ valid: true, errors: [] });
    });

    it('should return a warning without making the document invalid', () => {
        const unregister = registerDocumentValidator('warn', () => [
            buildError('SUI-LOCALE-MISSING', { locale: 'de', path: '$.app', statePath: '$.app' })
        ]);
        registered.push(unregister);

        const result = validateDocument(doc({ component: 'panel' }), LIBRARY);

        expect(result.valid).toBe(true);
        expect(result.errors.map((error) => error.code)).toEqual(['SUI-LOCALE-MISSING']);
    });

    it('should report an error beside a warning as invalid', () => {
        registered.push(registerDocumentValidator('warn', () => [buildError('SUI-LOCALE-MISSING', { locale: 'de', path: '$', statePath: '$' })]));

        const result = validateDocument(doc({ component: 'nope' }), LIBRARY);

        expect(result.valid).toBe(false);
    });

    it('should report SUI-DOC-SHAPE for a value that is not an object', () => {
        for (const value of [null, 3, 'x', [], undefined]) {
            expect(validateDocument(value, LIBRARY).errors).toEqual([
                { code: 'SUI-DOC-SHAPE', message: expect.any(String), statePath: '$' }
            ]);
        }
    });

    it('should report SUI-DOC-SHAPE for a value that cannot be serialised', () => {
        const loop: JsonObject = { app: { component: 'panel' } };
        loop['self'] = loop;

        expect(codes(loop)).toEqual(['SUI-DOC-SHAPE']);
    });

    it('should report SUI-DOC-TYPE for a wrongly typed root key', () => {
        const errors = validateDocument(doc({ component: 'panel' }, { data: [], locale: 3, themes: { a: 1 }, locales: 'x', theme: 'x' }), LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-DOC-TYPE', '$.theme'],
            ['SUI-DOC-TYPE', '$.themes'],
            ['SUI-DOC-TYPE', '$.locale'],
            ['SUI-DOC-TYPE', '$.data'],
            ['SUI-DOC-TYPE', '$.locales']
        ]);
    });

    it('should report SUI-DOC-TYPE for a composed entry that is not a node', () => {
        const errors = validateDocument(doc({ component: 'panel' }, { composed: { bad: 3 } }), LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-DOC-TYPE', '$.composed.bad']]);
    });

    it('should report SUI-NODE-MISSING when app is not a node', () => {
        const errors = validateDocument({ data: {} }, LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-NODE-MISSING', '$.app']]);
    });

    it('should report SUI-DOC-KEY for an unknown root key and for runtime', () => {
        const errors = validateDocument(doc({ component: 'panel' }, { runtime: {}, extra: 1 }), LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-DOC-KEY', '$.runtime'],
            ['SUI-DOC-KEY', '$.extra']
        ]);
    });

    it('should report SUI-DOC-COMPOSED for a composed name that is a library name, once', () => {
        const document = doc({ component: 'panel' }, { composed: { text: { component: 'panel' } } });

        const errors = validateDocument(document, LIBRARY).errors.filter((error) => error.code === 'SUI-DOC-COMPOSED');

        expect(errors.map((error) => error.statePath)).toEqual(['$.composed.text']);
    });

    it('should report SUI-DOC-ORDER for integer-like keys in ordered maps and data', () => {
        const document = doc(
            { component: 'panel', children: { '1': { component: 'text' }, ok: { component: 'text' } } },
            { data: { list: { '7': 1 }, nested: [{ '0': 1 }], fine: { a: 1 } } }
        );

        const errors = validateDocument(document, LIBRARY).errors.filter((error) => error.code === 'SUI-DOC-ORDER');

        expect(errors.map((error) => error.statePath)).toEqual(['$.app.children.1', '$.data.list.7', '$.data.nested.0.0']);
    });

    it('should report SUI-DOC-ORDER inside a composed tree and in other ordered maps', () => {
        const document = doc(
            { component: 'panel' },
            { composed: { box: { component: 'panel', children: { '2': { component: 'text' } } } } }
        );

        const errors = validateDocument(document, LIBRARY).errors.filter((error) => error.code === 'SUI-DOC-ORDER');

        expect(errors.map((error) => error.statePath)).toEqual(['$.composed.box.children.2']);
    });

    it('should not treat a key such as 01 or -1 as integer-like', () => {
        const document = doc({ component: 'panel', children: { '01': { component: 'text' }, '-1': { component: 'text' } } });

        expect(codes(document)).toEqual([]);
    });

    it('should report SUI-NODE-UNKNOWN with the state path', () => {
        const errors = validateDocument(doc({ component: 'panel', children: { x: { component: 'nope' } } }), LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-NODE-UNKNOWN', '$.app.children.x']]);
    });

    it('should report SUI-NODE-CYCLE for a composed component that contains itself', () => {
        const document = doc(
            { component: 'loop' },
            { composed: { loop: { component: 'panel', children: { again: { component: 'loop' } } } } }
        );

        expect(codes(document)).toContain('SUI-NODE-CYCLE');
    });

    it('should report SUI-NODE-NAME for a $ or __ property name', () => {
        const errors = validateDocument(doc({ component: 'text', $x: 1, __y: 2 }), LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-NODE-NAME', '$.app.$x'],
            ['SUI-NODE-NAME', '$.app.__y']
        ]);
    });

    it('should report SUI-STATE-INVALID for a value that does not fit its shape', () => {
        const errors = validateDocument(doc({ component: 'text', width: 'xl' }), LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-STATE-INVALID', '$.app.width']]);
    });

    it('should report SUI-STATE-UNKNOWN for a property or a content property the component lacks', () => {
        const errors = validateDocument(doc({ component: 'text', color: 'red', _caption: 'x' }), LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-STATE-UNKNOWN', '$.app.color'],
            ['SUI-STATE-UNKNOWN', '$.app._caption']
        ]);
    });

    it('should report SUI-STATE-REQUIRED for a missing required property', () => {
        const errors = validateDocument(doc({ component: 'icon' }), LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-STATE-REQUIRED', '$.app.name']]);
    });

    it('should report SUI-STATE-CONDITION for a property required under a condition', () => {
        const library: ComponentLibrary = {
            image: {
                tier: 'root',
                tag: 'ui-image',
                shape: shapeOf({
                    decorative: { type: 'boolean', default: false },
                    _alt: { type: 'string', kind: 'content', requiredWhen: { property: 'decorative', equals: false } }
                })
            }
        };

        const errors = validateDocument(doc({ component: 'image' }), library).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-STATE-CONDITION', '$.app._alt']]);
    });

    it('should report SUI-STATE-RUNTIME for a node that sets a runtime property', () => {
        const library: ComponentLibrary = {
            field: { tier: 'root', tag: 'ui-field', shape: shapeOf({ touched: { type: 'boolean', default: false, runtime: true } }) }
        };

        const errors = validateDocument(doc({ component: 'field', touched: true }), library).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-STATE-RUNTIME', '$.app.touched']]);
    });

    it('should check icon names with isIconName', () => {
        const result = validateDocument(doc({ component: 'icon', name: 'missing' }), LIBRARY, { isIconName: (name) => name === 'circle' });

        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-STATE-INVALID', '$.app.name']]);
    });

    it('should validate the nodes of a composed entry of the document', () => {
        const errors = validateDocument(doc({ component: 'panel' }, { composed: { card: { component: 'text', width: 'xl' } } }), LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-STATE-INVALID', '$.composed.card.width']]);
    });

    it('should accept an exposes map on a document composed entry', () => {
        const document = doc({ component: 'card' }, { composed: { card: { component: 'panel', exposes: { title: 'The heading', layout: 'How children sit' } } } });

        expect(codes(document)).toEqual([]);
    });

    it('should report SUI-DOC-EXPOSES for a path that resolves nowhere, with its state path', () => {
        const document = doc({ component: 'card' }, { composed: { card: { component: 'panel', exposes: { nope: 'Nothing' } } } });

        const errors = validateDocument(document, LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-DOC-EXPOSES', '$.composed.card.exposes.nope']]);
    });

    it('should report SUI-DOC-EXPOSES for an empty description and for an exposes that is not a map', () => {
        const empty = doc({ component: 'card' }, { composed: { card: { component: 'panel', exposes: { title: '' } } } });
        const list = doc({ component: 'card' }, { composed: { card: { component: 'panel', exposes: ['title'] } } });

        expect(validateDocument(empty, LIBRARY).errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-DOC-EXPOSES', '$.composed.card.exposes.title']]);
        expect(validateDocument(list, LIBRARY).errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-DOC-EXPOSES', '$.composed.card.exposes']]);
    });

    it('should resolve exposed paths through nested composed entries of the document', () => {
        const document = doc(
            { component: 'outer' },
            { composed: { inner: { component: 'panel', title: 'T' }, outer: { component: 'inner', exposes: { title: 'The heading' } } } }
        );

        expect(codes(document)).toEqual([]);
    });

    it('should report SUI-LINK-ROW for $row outside a row template', () => {
        const errors = validateDocument(doc({ component: 'text', '<-_value': '$row.name' }), LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-LINK-ROW', '$.app.<-_value']]);
    });

    it('should accept $row links in a row template of a list that sits directly in a node slot', () => {
        const list = { component: 'list', row: { component: 'text', '<-_value': '$row.name' } };

        expect(codes(doc({ component: 'modal', body: list }))).toEqual([]);
        expect(codes(doc({ component: 'modal', body: { component: 'panel', children: { list } } }))).toEqual([]);
    });

    it('should report $row outside a row template once for a node that sits directly in a node slot', () => {
        const errors = validateDocument(doc({ component: 'modal', body: { component: 'text', '<-_value': '$row.name' } }), LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-LINK-ROW', '$.app.body.<-_value']]);
    });

    it('should report $row outside a row template that sits beside a list in a node slot', () => {
        const list = { component: 'list', row: { component: 'text', '<-_value': '$row.name' } };
        const document = doc({ component: 'modal', body: list, footer: { component: 'text', '<-_value': '$row.name' } });

        const errors = validateDocument(document, LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-LINK-ROW', '$.app.footer.<-_value']]);
    });

    it('should accept null that removes an entry of a map property in a composed override', () => {
        const document = doc({ component: 'panel', children: { c: { component: 'ordersTable', children: { table: { columns: { actions: null } } } } } });

        expect(validateDocument(document, ORDERS_LIBRARY)).toEqual({ valid: true, errors: [] });
    });

    it('should still report a null that is a value of a property that does not allow it', () => {
        const document = doc({ component: 'panel', children: { c: { component: 'ordersTable', children: { table: { title: null } } } } });

        expect(validateDocument(document, ORDERS_LIBRARY).errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-STATE-INVALID', '$.app.children.c.children.table.title']
        ]);
    });

    it('should report SUI-LINK-TARGET for a link target that is not allowed', () => {
        const errors = validateDocument(doc({ component: 'text', '<-_value': '$.theme.x' }), LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-LINK-TARGET', '$.app']]);
    });

    it('should report SUI-LINK-MISSING for a data link to a path that does not exist', () => {
        const errors = validateDocument(doc({ component: 'text', '<-_value': '$.data.nope.x' }, {}), LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-LINK-MISSING', '$.app']]);
    });

    it('should accept a data link into an array by index', () => {
        const document = doc({ component: 'text', '<-_value': '$.data.rows.1.name' }, { data: { rows: [{ name: 'a' }, { name: 'b' }] } });

        expect(codes(document)).toEqual([]);
    });

    it('should report SUI-LINK-MISSING for a node reference that does not resolve', () => {
        const document = doc({ component: 'panel', children: { a: { component: 'text', '<-label': '^nobody.label' } } });

        const errors = validateDocument(document, LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-LINK-MISSING', '$.app.children.a']]);
    });

    it('should accept a node reference to an exposed runtime property', () => {
        const document = doc({
            component: 'panel',
            children: {
                orders: { component: 'records' },
                detail: { component: 'text', '<-label': '^app.children.orders.current.customer' }
            }
        });

        expect(codes(document)).toEqual([]);
    });

    it('should report SUI-LINK-MISSING for a node reference to a property that is not exposed', () => {
        const document = doc({
            component: 'panel',
            children: {
                a: { component: 'records' },
                b: { component: 'text', '<-label': '^app.children.a.nope' },
                c: { component: 'text', '<-label': '^app.children.a.concealed' },
                d: { component: 'text', '<-label': '^app.children.a.title' }
            }
        });

        const errors = validateDocument(document, LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-LINK-MISSING', '$.app.children.b'],
            ['SUI-LINK-MISSING', '$.app.children.c'],
            ['SUI-LINK-MISSING', '$.app.children.d']
        ]);
    });

    it('should report SUI-LINK-TARGET for climbing and absolute app targets', () => {
        const document = doc({
            component: 'panel',
            children: {
                a: { component: 'text', '<-label': '..x' },
                b: { component: 'text', '<-label': '$.app.children.a.label' }
            }
        });

        const errors = validateDocument(document, LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-LINK-TARGET', '$.app.children.a'],
            ['SUI-LINK-TARGET', '$.app.children.b']
        ]);
    });

    it('should validate a node field of a map item and resolve its node reference against the owner', () => {
        const document = doc({
            component: 'panel',
            children: {
                orders: {
                    component: 'records',
                    columns: {
                        status: {
                            cell: { component: 'text', '<-label': '$row.status', '<-_value': '^orders.current.status' }
                        },
                        bad: { cell: { component: 'text', nope: 1 } }
                    }
                }
            }
        });

        const errors = validateDocument(document, LIBRARY).errors;

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-STATE-UNKNOWN', '$.app.children.orders.columns.bad.cell.nope']
        ]);
    });

    it('should report $row in a map-item node field that is not a row template', () => {
        const document = doc({
            component: 'panel',
            children: { orders: { component: 'records', columns: { x: { plain: { component: 'text', '<-label': '$row.a' } } } } }
        });

        expect(validateDocument(document, LIBRARY).errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-LINK-ROW', '$.app.children.orders.columns.x.plain.<-label']
        ]);
    });

    it('should report SUI-ON-EVENT from the on validator', () => {
        const document = doc({ component: 'button', on: { hover: { command: 'set', target: '$.data.x', value: 1 } } });

        expect(codes(document)).toEqual(['SUI-ON-EVENT']);
    });

    it('should report SUI-ON-COMMAND from the on validator', () => {
        const document = doc({
            component: 'panel',
            children: { f: { component: 'form' }, b: { component: 'button', on: { press: { command: 'open', target: '$.app.children.f' } } } }
        });

        expect(codes(document)).toEqual(['SUI-ON-COMMAND']);
    });

    it('should report SUI-ON-TARGET from the on validator', () => {
        const document = doc({ component: 'button', on: { press: { command: 'toggle', target: '..pressed' } } });

        expect(codes(document)).toEqual(['SUI-ON-TARGET']);
    });

    it('should run the registered validators in order and merge their errors', () => {
        const calls: string[] = [];
        registered.push(
            registerDocumentValidator('first', () => {
                calls.push('first');
                return [buildError('SUI-NODE-MISSING', { path: '$.app.a', statePath: '$.app.a' })];
            }),
            registerDocumentValidator('second', () => {
                calls.push('second');
                return [buildError('SUI-NODE-MISSING', { path: '$.app.b', statePath: '$.app.b' })];
            })
        );

        const errors = validateDocument(doc({ component: 'panel' }), LIBRARY).errors;

        expect(documentValidators().map(([name]) => name)).toEqual(['on', 'layout', 'placement', 'step', 'logic', 'route', 'first', 'second']);
        expect(calls).toEqual(['first', 'second']);
        expect(errors.map((error) => error.statePath)).toEqual(['$.app.a', '$.app.b']);
    });

    it('should stop running a removed validator', () => {
        const validator = vi.fn(() => []);
        const unregister = registerDocumentValidator('gone', validator);
        unregister();

        validateDocument(doc({ component: 'panel' }), LIBRARY);

        expect(validator).not.toHaveBeenCalled();
    });

    it('should report a throwing validator as SUI-DOC-VALIDATOR and keep the other errors', () => {
        registered.push(
            registerDocumentValidator('boom', () => {
                throw new Error('bad');
            })
        );

        const errors = validateDocument(doc({ component: 'nope' }), LIBRARY).errors;

        expect(errors.map((error) => error.code)).toEqual(['SUI-NODE-UNKNOWN', 'SUI-DOC-VALIDATOR']);
    });

    it('should return every error of one run, each with a state path', () => {
        const document = doc(
            { component: 'panel', children: { x: { component: 'nope' }, 1: { component: 'text', width: 'xl' } } },
            { extra: 1 }
        );

        const errors = validateDocument(document, LIBRARY).errors;

        expect(errors.length).toBeGreaterThanOrEqual(4);
        expect(errors.every((error) => typeof error.statePath === 'string')).toBe(true);
    });

    it('should read the components of a catalog', () => {
        const catalog = {
            components: [
                { name: 'text', tier: 'root' as const, tag: 'ui-text', shape: (LIBRARY['text'] as { shape: Shape }).shape },
                { name: 'card', tier: 'composed' as const, tree: { component: 'text' } }
            ]
        };

        expect(Object.keys(libraryFromCatalog(catalog))).toEqual(['text', 'card']);
        expect(validateDocument(doc({ component: 'card', width: 'xl' }), catalog).errors.map((error) => error.code)).toEqual([
            'SUI-STATE-INVALID'
        ]);
    });

    it('should move a catalog entry placement into its shape', () => {
        // Arrange
        const shape = (LIBRARY['text'] as { shape: Shape }).shape;
        const placement = { _tab: { type: 'string' as const } };
        const catalog = { components: [{ name: 'text', tier: 'root' as const, tag: 'ui-text', shape, placement }] };

        // Act
        const entry = libraryFromCatalog(catalog)['text'] as { shape: Shape };

        // Assert
        expect(entry.shape.placement).toEqual(placement);
        expect(shape.placement).toBeUndefined();
    });
});

describe('validateDocument limits', () => {
    /** A library that records every lookup, so a test can tell whether anything was resolved */
    function spiedLibrary(): { library: ComponentLibrary; lookups: ReturnType<typeof vi.fn> } {
        const lookups = vi.fn();
        const library = new Proxy(LIBRARY as Record<string, unknown>, {
            get(target, key) {
                lookups(key);
                return target[key as string];
            },
            getOwnPropertyDescriptor(target, key) {
                lookups(key);
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
            has(target, key) {
                lookups(key);
                return key in target;
            }
        }) as ComponentLibrary;
        return { library, lookups };
    }

    function flat(count: number): Node {
        const children: JsonObject = {};
        for (let i = 0; i < count - 1; i++) children[`n${i}`] = { component: 'nope' };
        return { component: 'panel', children };
    }

    function deep(levels: number): Node {
        let node: Node = { component: 'nope' };
        for (let i = 1; i < levels; i++) node = { component: 'panel', children: { c: node } };
        return node;
    }

    it('should return only the node limit error and resolve nothing', () => {
        const { library, lookups } = spiedLibrary();
        const document = doc(flat(MAX_NODES + 1), { extra: 1 });

        const result = validateDocument(document, library);

        expect(result.errors.map((error) => error.code)).toEqual(['SUI-DOC-LIMIT-NODES']);
        expect(result.valid).toBe(false);
        expect(lookups).not.toHaveBeenCalled();
    });

    it('should return only the depth limit error and resolve nothing', () => {
        const { library, lookups } = spiedLibrary();

        const result = validateDocument(doc(deep(MAX_DEPTH + 1), { extra: 1 }), library);

        expect(result.errors.map((error) => error.code)).toEqual(['SUI-DOC-LIMIT-DEPTH']);
        expect(lookups).not.toHaveBeenCalled();
    });

    it('should return only the byte limit error and resolve nothing', () => {
        const { library, lookups } = spiedLibrary();

        const result = validateDocument(doc({ component: 'text', label: 'x'.repeat(1024 * 1024) }, { extra: 1 }), library);

        expect(result.errors.map((error) => error.code)).toEqual(['SUI-DOC-LIMIT-BYTES']);
        expect(lookups).not.toHaveBeenCalled();
    });

    it('should return the data limit error and resolve nothing', () => {
        const { library, lookups } = spiedLibrary();

        const result = validateDocument(doc({ component: 'panel' }, { data: { blob: 'x'.repeat(600 * 1024) } }), library);

        expect(result.errors.map((error) => error.code)).toEqual(['SUI-DOC-LIMIT-DATA']);
        expect(result.errors[0]?.statePath).toBe('$');
        expect(lookups).not.toHaveBeenCalled();
    });

    it('should run the plug-in validators only when the limits hold', () => {
        const validator = vi.fn(() => []);
        const unregister = registerDocumentValidator('spy', validator);
        try {
            validateDocument(doc(flat(MAX_NODES + 1)), LIBRARY);
            expect(validator).not.toHaveBeenCalled();

            validateDocument(doc({ component: 'panel' }), LIBRARY);
            expect(validator).toHaveBeenCalledTimes(1);
        } finally {
            unregister();
        }
    });
});

describe('validateDocument child components', () => {
    function parsed(json: Record<string, unknown>): Shape {
        const result = parseShape({ summary: 'Test', ...json }, 'test.state.json');
        expect(result.errors).toEqual([]);
        return result.shape as Shape;
    }

    const RESTRICTED: ComponentLibrary = {
        ...LIBRARY,
        item: { tier: 'root', tag: 'ui-item', shape: parsed({ properties: { label: { type: 'string', default: '' } } }) },
        stack: { tier: 'root', tag: 'ui-stack', shape: parsed({ childComponents: ['item'] }) },
        card: {
            tier: 'root',
            tag: 'ui-card',
            shape: parsed({ properties: { footer: { type: 'node', childComponents: ['button'] }, body: { type: 'node' } } })
        },
        wrapped: { tier: 'composed', tree: { component: 'item', label: 'wrapped' } }
    };

    function restricted(document: unknown): { code: string; statePath?: string }[] {
        return validateDocument(document, RESTRICTED).errors.map((error) => ({ code: error.code, statePath: error.statePath }));
    }

    it('should accept children of a listed component', () => {
        const document = doc({ component: 'stack', children: { a: { component: 'item' }, b: { component: 'item' } } });

        expect(restricted(document)).toEqual([]);
    });

    it('should report SUI-NODE-CHILD with the state path for a child that is not listed', () => {
        const document = doc({ component: 'stack', children: { a: { component: 'item' }, b: { component: 'text' } } });

        expect(restricted(document)).toEqual([{ code: 'SUI-NODE-CHILD', statePath: '$.app.children.b' }]);
    });

    it('should name the accepted components in the message', () => {
        const errors = validateDocument(doc({ component: 'stack', children: { a: { component: 'text' } } }), RESTRICTED).errors;

        expect(errors[0]?.message).toContain('"text"');
        expect(errors[0]?.message).toContain('item');
    });

    it('should accept a composed component that resolves to a listed component', () => {
        const document = doc({ component: 'stack', children: { a: { component: 'wrapped' } } });

        expect(restricted(document)).toEqual([]);
    });

    it('should check a node-typed slot that lists components', () => {
        const wrong = doc({ component: 'card', footer: { component: 'text' }, body: { component: 'text' } });
        const right = doc({ component: 'card', footer: { component: 'button' } });

        expect(restricted(wrong)).toEqual([{ code: 'SUI-NODE-CHILD', statePath: '$.app.footer' }]);
        expect(restricted(right)).toEqual([]);
    });

    it('should check the children inside a composed tree', () => {
        const document = doc(
            { component: 'panel' },
            { composed: { bad: { component: 'stack', children: { a: { component: 'text' } } } } }
        );

        expect(restricted(document)).toContainEqual({ code: 'SUI-NODE-CHILD', statePath: '$.composed.bad.children.a' });
    });

    it('should read childComponents from the shape in a catalog', () => {
        const catalog = {
            components: [
                { name: 'item', tier: 'root', tag: 'ui-item', shape: parsed({}) },
                { name: 'text', tier: 'root', tag: 'ui-text', shape: parsed({}) },
                { name: 'stack', tier: 'root', tag: 'ui-stack', shape: parsed({ childComponents: ['item'] }) }
            ]
        } as unknown as Parameters<typeof libraryFromCatalog>[0];

        const result = validateDocument(doc({ component: 'stack', children: { a: { component: 'text' } } }), catalog);

        expect(result.errors.map((error) => error.code)).toEqual(['SUI-NODE-CHILD']);
    });
});

describe('validateDocument $.server', () => {
    const usesServer = doc({
        component: 'panel',
        children: {
            save: { component: 'button', on: { press: [{ command: 'set', target: '$.server.token', value: 'x' }] } },
            name: { component: 'text', _value: 'A $.server mention in text is fine' }
        }
    });

    it('should refuse a link into $.server in every mode', () => {
        const document = doc({ component: 'text', '<-_value': '$.server.apiKey' });

        const results = [undefined, 'full', 'standalone'].map((mode) =>
            validateDocument(document, LIBRARY, mode === undefined ? {} : { mode: mode as 'full' | 'standalone' })
        );

        for (const result of results) {
            expect(result.valid).toBe(false);
            expect(result.errors.map((error) => error.code)).toContain('SUI-LINK-SERVER');
        }
        expect(results[0]?.errors[0]?.message).toContain('$.server.apiKey');
    });

    it('should refuse a document that uses $.server in Standalone and Persisted mode', () => {
        for (const mode of ['standalone', 'persisted'] as const) {
            const result = validateDocument(usesServer, LIBRARY, { mode });

            expect(result.valid).toBe(false);
            expect(result.errors.filter((error) => error.code === 'SUI-DOC-SERVER')).toEqual([
                expect.objectContaining({ statePath: '$.app.children.save.on.press.0.target' })
            ]);
            expect(result.errors.find((error) => error.code === 'SUI-DOC-SERVER')?.message).toContain(`${mode} mode`);
        }
    });

    it('should allow a document that uses $.server in Full mode and without a mode', () => {
        expect(codes(usesServer)).not.toContain('SUI-DOC-SERVER');
        expect(validateDocument(usesServer, LIBRARY, { mode: 'full' }).errors.map((error) => error.code)).not.toContain('SUI-DOC-SERVER');
    });

    it('should accept a Standalone document that does not use $.server', () => {
        const document = doc({ component: 'text', '<-_value': '$.data.serverName' }, { data: { serverName: '$.serverless' } });

        expect(validateDocument(document, LIBRARY, { mode: 'standalone' })).toEqual({ valid: true, errors: [] });
    });
});

const FIELD_LIBRARY: ComponentLibrary = Object.freeze({
    ...LIBRARY,
    numberField: {
        tier: 'root',
        tag: 'ui-number-field',
        shape: shapeOf({ value: { type: ['number', 'string'], default: '' }, min: { type: 'number' }, step: { type: 'number', default: 0 } })
    },
    pagedList: {
        tier: 'root',
        tag: 'ui-paged-list',
        shape: shapeOf({ items: { type: 'map', items: 'string', default: {} }, total: { type: 'number', default: 0 } })
    }
});

describe('validateDocument: paged record keys', () => {
    it('should accept position keys in the items of a node with an integer total', () => {
        // Arrange
        const items = Object.freeze({ '20': { id: 'a' }, '21': { id: 'b' } });
        const document = doc({ component: 'pagedList', items: { ...items }, total: 42 });

        // Act
        const errors = validateDocument(document, FIELD_LIBRARY).errors.filter((error) => error.code === 'SUI-DOC-ORDER');

        // Assert
        expect(errors).toEqual([]);
    });

    it('should still report integer-like keys in the items of a node with no total', () => {
        const document = doc({ component: 'pagedList', items: { '20': { id: 'a' } } });

        const errors = validateDocument(document, FIELD_LIBRARY).errors.filter((error) => error.code === 'SUI-DOC-ORDER');

        expect(errors.map((error) => error.statePath)).toEqual(['$.app.items.20']);
    });
});

describe('validateDocument: number field min and step', () => {
    const codes = (app: Node): { code: string; severity?: string; statePath?: string }[] =>
        validateDocument(doc(app), FIELD_LIBRARY).errors.filter((error) => error.code === 'SUI-STATE-STEP');

    it('should warn when min is not a multiple of step', () => {
        // Arrange
        const app = { component: 'numberField', min: 0.01, step: 1 } as Node;

        // Act
        const found = codes(app);

        // Assert
        expect(found).toHaveLength(1);
        expect(found[0]?.severity).toBe('warning');
        expect(found[0]?.statePath).toBe('$.app');
        expect(validateDocument(doc(app), FIELD_LIBRARY).valid).toBe(true);
    });

    it('should name the fix in the message', () => {
        const message = validateDocument(doc({ component: 'numberField', min: 0.5, step: 1 } as Node), FIELD_LIBRARY).errors[0]?.message;

        expect(message).toContain('min: 0');
        expect(message).toContain('divides min');
    });

    it('should accept a min that is a multiple of step, including decimals', () => {
        expect(codes({ component: 'numberField', min: 0, step: 1 } as Node)).toEqual([]);
        expect(codes({ component: 'numberField', min: 0.3, step: 0.1 } as Node)).toEqual([]);
        expect(codes({ component: 'numberField', min: -10, step: 5 } as Node)).toEqual([]);
    });

    it('should not warn with no step, a zero step or no min', () => {
        expect(codes({ component: 'numberField', min: 0.01 } as Node)).toEqual([]);
        expect(codes({ component: 'numberField', min: 0.01, step: 0 } as Node)).toEqual([]);
        expect(codes({ component: 'numberField', step: 1 } as Node)).toEqual([]);
    });

    it('should warn for a fractional step that min does not divide', () => {
        expect(codes({ component: 'numberField', min: 0.25, step: 0.1 } as Node)).toHaveLength(1);
    });

    it('should find the field inside a composed tree and a child', () => {
        const document = doc(
            { component: 'panel', children: { amount: { component: 'numberField', min: 1.5, step: 1 } } },
            { composed: { money: { component: 'numberField', min: 0.01, step: 1 } } }
        );

        const paths = validateDocument(document, FIELD_LIBRARY).errors.filter((error) => error.code === 'SUI-STATE-STEP').map((error) => error.statePath);

        expect(paths).toEqual(['$.app.children.amount', '$.composed.money']);
    });
});
