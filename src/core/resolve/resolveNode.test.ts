import { describe, expect, it } from 'vitest';
import { checkComposedNames, mergeValues, resolveNode } from './index.js';
import type { ComponentLibrary } from './index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { JsonValue, Node } from '../types.js';

function shapeOf(properties: Record<string, unknown>, extra: Record<string, unknown> = {}): Shape {
    const result = parseShape({ summary: 'Test', properties, ...extra }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const LIBRARY: ComponentLibrary = {
    text: { tier: 'root', tag: 'ui-text', shape: shapeOf({ _text: { type: 'string', kind: 'content', default: 'Text' }, mood: { type: 'string', default: 'plain' } }) },
    button: { tier: 'root', tag: 'ui-button', shape: shapeOf({ _title: { type: 'string', kind: 'content', default: 'Go' }, look: { type: 'string', default: 'solid' } }) },
    toolbar: { tier: 'root', tag: 'ui-toolbar', shape: shapeOf({ align: { type: 'string', default: 'start' } }) },
    modal: {
        tier: 'root',
        tag: 'ui-modal',
        shape: shapeOf({ _title: { type: 'string', kind: 'content', default: 'Title' }, body: { type: 'node' }, footer: { type: 'node' } })
    },
    confirmDialog: {
        tier: 'composed',
        tree: {
            component: 'modal',
            _title: 'Are you sure?',
            body: { component: 'text', _text: 'This cannot be undone.' },
            footer: {
                component: 'toolbar',
                children: {
                    cancel: { component: 'button', _title: 'Cancel' },
                    confirm: { component: 'button', _title: 'Delete', on: { press: [{ command: 'close', target: '^confirmDialog' }] } }
                }
            },
            exposes: { _title: 'Dialog title' }
        }
    },
    deleteDialog: {
        tier: 'composed',
        tree: { component: 'confirmDialog', _title: 'Delete it?', footer: { children: { cancel: null } } }
    },
    grid: {
        tier: 'root',
        tag: 'ui-grid',
        shape: shapeOf({
            columns: { type: 'map', items: { _title: { type: 'string', kind: 'content', default: '' } }, default: {} },
            note: { type: 'any', default: 'x' }
        })
    },
    gridPage: {
        tier: 'composed',
        tree: {
            component: 'toolbar',
            children: { table: { component: 'grid', columns: { name: { _title: 'Name' }, actions: { _title: 'Actions' } } } }
        }
    },
    loopA: { tier: 'composed', tree: { component: 'toolbar', children: { inner: { component: 'loopB' } } } },
    loopB: { tier: 'composed', tree: { component: 'toolbar', children: { inner: { component: 'loopA' } } } }
};

function resolve(node: Node, composed: Record<string, Node> = {}) {
    return resolveNode(node, LIBRARY, composed);
}

describe('resolveNode', () => {
    it('should merge a node over the defaults of a root component', () => {
        const result = resolve({ component: 'text', _text: 'Hi' });

        expect(result.errors).toEqual([]);
        expect(result.node).toEqual({ component: 'text', _text: 'Hi', mood: 'plain' });
    });

    it('should override a nested node by path when the component is composed', () => {
        const result = resolve({
            component: 'confirmDialog',
            body: { _text: 'Delete order 5?' },
            footer: { children: { confirm: { _title: 'Remove' } } }
        });

        expect(result.errors).toEqual([]);
        const node = result.node as Record<string, any>;
        expect(node.component).toBe('modal');
        expect(node._title).toBe('Are you sure?');
        expect(node.body).toEqual({ component: 'text', _text: 'Delete order 5?', mood: 'plain' });
        expect(node.footer.children.confirm._title).toBe('Remove');
        expect(node.footer.children.confirm.look).toBe('solid');
        expect(node.footer.children.confirm.on).toEqual({ press: [{ command: 'close', target: '^confirmDialog' }] });
        expect(node.footer.children.cancel._title).toBe('Cancel');
    });

    it('should resolve a composed component inside a composed component', () => {
        const result = resolve({ component: 'deleteDialog', body: { _text: 'Sure?' } });

        expect(result.errors).toEqual([]);
        const node = result.node as Record<string, any>;
        expect(node.component).toBe('modal');
        expect(node._title).toBe('Delete it?');
        expect(node.body._text).toBe('Sure?');
        expect(Object.keys(node.footer.children)).toEqual(['confirm']);
        expect(result.instances).toEqual({ '$.app': ['deleteDialog', 'confirmDialog'] });
    });

    it('should resolve composed nodes nested in children and record their paths', () => {
        const result = resolve({
            component: 'toolbar',
            children: { dialog: { component: 'confirmDialog' }, other: { component: 'text' } }
        });

        const children = (result.node as Record<string, any>).children;
        expect(children.dialog.component).toBe('modal');
        expect(children.other).toEqual({ component: 'text', _text: 'Text', mood: 'plain' });
        expect(result.instances).toEqual({ '$.app.children.dialog': ['confirmDialog'] });
    });

    it('should allow a composed component inside its own slot when the user places it there', () => {
        const result = resolve({ component: 'confirmDialog', body: { component: 'confirmDialog' } });

        expect(result.errors).toEqual([]);
        expect((result.node as Record<string, any>).body.component).toBe('modal');
    });

    it('should report a cycle with the chain and the state path', () => {
        const result = resolve({ component: 'toolbar', children: { x: { component: 'loopA' } } });

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({
            code: 'SUI-NODE-CYCLE',
            statePath: '$.app.children.x',
            component: 'loopA'
        });
        expect(result.errors[0]?.message).toContain('loopA > loopB > loopA');
    });

    it('should report a component that contains itself', () => {
        const result = resolve({ component: 'me' }, { me: { component: 'toolbar', children: { a: { component: 'me' } } } });

        expect(result.errors.map((error) => error.code)).toEqual(['SUI-NODE-CYCLE']);
    });

    it('should report an unknown component with its state path and keep the node as written', () => {
        const result = resolve({ component: 'toolbar', children: { a: { component: 'nope', x: 1 } } });

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ code: 'SUI-NODE-UNKNOWN', statePath: '$.app.children.a', component: 'nope' });
        expect((result.node as Record<string, any>).children.a).toEqual({ component: 'nope', x: 1 });
    });

    it('should remove a default child when the node sets it to null', () => {
        const result = resolve({ component: 'confirmDialog', footer: { children: { cancel: null } } });

        expect(Object.keys((result.node as Record<string, any>).footer.children)).toEqual(['confirm']);
    });

    it('should remove a default slot node when the node sets it to null', () => {
        const result = resolve({ component: 'confirmDialog', body: null });

        expect((result.node as Record<string, any>).body).toBeUndefined();
    });

    it('should replace arrays whole', () => {
        const result = resolve({
            component: 'confirmDialog',
            footer: { children: { confirm: { on: { press: [{ command: 'set', target: '$.app.x' }] } } } }
        });

        const press = (result.node as Record<string, any>).footer.children.confirm.on.press;
        expect(press).toEqual([{ command: 'set', target: '$.app.x' }]);
    });

    it('should never merge the exposes key into a resolved node', () => {
        const result = resolve({ component: 'confirmDialog' });
        const composed = resolve({ component: 'mine' }, { mine: { component: 'text', exposes: { _text: 'The text' } } });

        expect(result.node).not.toHaveProperty('exposes');
        expect(composed.node).not.toHaveProperty('exposes');
    });

    it('should prefer a document composed entry over the library', () => {
        const result = resolve({ component: 'mine' }, { mine: { component: 'text', _text: 'Mine' } });

        expect(result.errors).toEqual([]);
        expect(result.node).toMatchObject({ component: 'text', _text: 'Mine' });
    });

    it('should report a SUI-DOC error when a document composed name is a library name', () => {
        const composed = { text: { component: 'button' } } as Record<string, Node>;

        const result = resolve({ component: 'text' }, composed);

        expect(checkComposedNames(LIBRARY, composed).map((error) => error.code)).toEqual(['SUI-DOC-COMPOSED']);
        expect(result.errors[0]).toMatchObject({ code: 'SUI-DOC-COMPOSED', statePath: '$.composed.text' });
    });

    it('should resolve from the given path', () => {
        const result = resolveNode({ component: 'nope' }, LIBRARY, {}, { path: '$.composed.a' });

        expect(result.errors[0]?.statePath).toBe('$.composed.a');
    });

    it('should not change its inputs and should share nothing with them', () => {
        const node: Node = {
            component: 'confirmDialog',
            body: { _text: 'x' },
            footer: { children: { cancel: null, confirm: { on: { press: [{ command: 'a' }] } } } }
        };
        const composed: Record<string, Node> = { mine: { component: 'confirmDialog', exposes: { _title: 'T' } } };
        const nodeCopy = JSON.stringify(node);
        const composedCopy = JSON.stringify(composed);
        const libraryCopy = JSON.stringify(LIBRARY);

        const result = resolve(node, composed);
        resolve({ component: 'mine' }, composed);
        (result.node as Record<string, any>).footer.children.confirm.on.press.push('mutated');
        (result.node as Record<string, any>).body._text = 'changed';

        expect(JSON.stringify(node)).toBe(nodeCopy);
        expect(JSON.stringify(composed)).toBe(composedCopy);
        expect(JSON.stringify(LIBRARY)).toBe(libraryCopy);
    });
});

describe('resolveNode shape components', () => {
    const SHAPES: ComponentLibrary = {
        ...LIBRARY,
        dot: { tier: 'shape', shape: shapeOf({ r: { type: 'number', default: 4 }, fill: { type: 'string', default: 'ink' } }) },
        group: { tier: 'shape', shape: shapeOf({ clip: { type: 'boolean', default: false } }, { childComponents: ['dot'] }) },
        marker: { tier: 'composed', tree: { component: 'dot', r: 9 } }
    };

    it('should merge a shape node over its shape defaults, with its children resolved', () => {
        const node: Node = { component: 'group', children: { a: { component: 'dot', r: 2 }, b: { component: 'marker' } } };

        const result = resolveNode(node, SHAPES);

        expect(result.errors).toEqual([]);
        expect(result.node).toEqual({
            component: 'group',
            clip: false,
            children: { a: { component: 'dot', r: 2, fill: 'ink' }, b: { component: 'dot', r: 9, fill: 'ink' } }
        });
        expect(result.instances).toEqual({ '$.app.children.b': ['marker'] });
    });
});

describe('null in a map property', () => {
    it('should remove an entry of a map property of a nested node in a composed override', () => {
        const result = resolve({ component: 'gridPage', children: { table: { columns: { actions: null } } } });

        expect(result.errors).toEqual([]);
        expect(result.node).toEqual({
            component: 'toolbar',
            align: 'start',
            children: { table: { component: 'grid', columns: { name: { _title: 'Name' } }, note: 'x' } }
        });
    });

    it('should remove an entry of a map property of a root node, and ignore one that is not there', () => {
        const result = resolve({ component: 'grid', columns: { gone: null, kept: { _title: 'K' } } });

        expect(result.node).toEqual({ component: 'grid', columns: { kept: { _title: 'K' } }, note: 'x' });
    });

    it('should remove an entry through a composed component inside a composed component', () => {
        const result = resolve(
            { component: 'outerPage', children: { table: { columns: { actions: null } } } },
            { outerPage: { component: 'gridPage' } }
        );

        expect(result.node).toMatchObject({ children: { table: { columns: { name: { _title: 'Name' } } } } });
        expect(JSON.stringify(result.node)).not.toContain('actions');
    });

    it('should keep a null that is a value: a nullable property and a map set to null as a whole', () => {
        const nullable = resolve({ component: 'gridPage', children: { table: { note: null } } });
        const whole = resolve({ component: 'gridPage', children: { table: { columns: null } } });

        expect(nullable.node).toMatchObject({ children: { table: { note: null } } });
        expect(whole.node).toMatchObject({ children: { table: { columns: null } } });
    });

    it('should keep a null in a property that is not a map, even when it is an object', () => {
        const merged = mergeValues({ component: 'grid', note: { a: 1 } }, { note: { a: null } }, false, (name) =>
            name === 'grid' ? (LIBRARY['grid'] as { shape: Shape }).shape : undefined
        );

        expect(merged).toEqual({ component: 'grid', note: { a: null } });
    });
});

describe('mergeValues', () => {
    it('should replace a node with a node of another component', () => {
        const merged = mergeValues({ component: 'text', _text: 'a' }, { component: 'button' });

        expect(merged).toEqual({ component: 'button' });
    });

    it('should keep a null for a plain property', () => {
        const merged: JsonValue = mergeValues({ a: 1 }, { a: null });

        expect(merged).toEqual({ a: null });
    });
});
