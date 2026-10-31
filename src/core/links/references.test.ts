import { createStore } from '@punyts/state';
import { describe, expect, it } from 'vitest';
import type { ComponentLibrary } from '../resolve/index.js';
import { resolveNode } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { Node } from '../types.js';
import { applyLinks, extractLinks, resolveRowLinks } from './index.js';

function shapeOf(properties: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', properties }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const LIBRARY: ComponentLibrary = {
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({}) },
    records: {
        tier: 'root',
        tag: 'ui-records',
        shape: shapeOf({
            current: { type: 'any', runtime: true, exposed: true, default: {} },
            hidden: { type: 'any', runtime: true, default: {} },
            title: { type: 'string', default: '' },
            row: { type: 'node', row: true }
        })
    },
    descriptionList: { tier: 'root', tag: 'ui-description-list', shape: shapeOf({ value: { type: 'any' }, other: { type: 'any' } }) }
};

function extract(app: Node) {
    const resolved = resolveNode(app, LIBRARY);
    expect(resolved.errors).toEqual([]);
    return extractLinks(resolved.node, { library: LIBRARY, instances: resolved.instances });
}

const ORDERS = '$.runtime.nodes.app.children.orders';

describe('extractLinks with node references', () => {
    it('should resolve ^name.path to the runtime path of an exposed property', () => {
        // Arrange
        const app: Node = {
            component: 'panel',
            children: {
                orders: { component: 'records', row: { component: 'descriptionList' } },
                other: { component: 'descriptionList' }
            }
        };
        (app.children as Record<string, Node>).orders = {
            component: 'records',
            children: { detail: { component: 'descriptionList', '<-value': '^orders.current.customer' } }
        } as Node;

        // Act
        const result = extract(app);

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.links).toEqual([
            { statePath: '$.app.children.orders.children.detail', key: 'value', target: `${ORDERS}.current.customer` }
        ]);
    });

    it('should resolve .path against the own subtree', () => {
        const result = extract({ component: 'records', children: { x: { component: 'descriptionList' } }, '<-title': '.current.name' });

        expect(result.errors).toEqual([]);
        expect(result.links[0]?.target).toBe('$.runtime.nodes.app.current.name');
    });

    it('should report SUI-LINK-MISSING for a property that is not exposed, one that does not exist and a missing node', () => {
        const result = extract({
            component: 'records',
            '<-title': '.hidden',
            children: {
                a: { component: 'descriptionList', '<-value': '^records.title', '<-other': '^nobody.current' },
                b: { component: 'descriptionList', '<-value': '^app.nope' }
            }
        });

        expect(result.links).toEqual([]);
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-LINK-MISSING', '$.app'],
            ['SUI-LINK-MISSING', '$.app.children.a'],
            ['SUI-LINK-MISSING', '$.app.children.a'],
            ['SUI-LINK-MISSING', '$.app.children.b']
        ]);
    });

    it('should report SUI-LINK-TARGET for climbing, absolute app and other node references', () => {
        const result = extract({
            component: 'descriptionList',
            '<-value': '..current',
            '<-other': '$.app.children.orders.current'
        });

        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-LINK-TARGET', '$.app'],
            ['SUI-LINK-TARGET', '$.app']
        ]);
    });

    it('should return node references as written without a library', () => {
        const { links } = extractLinks({ component: 'x', '<-a': '^orders.current' });

        expect(links[0]?.target).toBe('^orders.current');
    });

    it('should resolve relative references in a row template against the owner', () => {
        // Arrange
        const app: Node = {
            component: 'panel',
            children: {
                orders: {
                    component: 'records',
                    row: { component: 'descriptionList', '<-value': '.current.id', '<-other': '$row.name' }
                }
            }
        };

        // Act
        const result = extract(app);

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.links.map((link) => link.target)).toEqual([`${ORDERS}.current.id`, '$row.name']);
    });

    it('should resolve relative references of a slot against the owner chain when one is given', () => {
        // Arrange
        const resolved = resolveNode({ component: 'panel', children: { orders: { component: 'records' } } }, LIBRARY);
        const frames = [
            { path: '$.app', key: 'app', node: resolved.node as never, instances: [] },
            { path: '$.app.children.orders', key: 'orders', node: (resolved.node.children as never as Record<string, never>).orders, instances: [] }
        ];
        const slot: Node = { component: 'descriptionList', '<-value': '^orders.current.id', '<-other': '$row.name' };

        // Act
        const result = resolveRowLinks(slot, `${ORDERS}.slots.3.row`, {
            library: LIBRARY,
            owner: frames,
            path: `${ORDERS}.slots.3`
        });

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.links.map((link) => link.target)).toEqual([`${ORDERS}.current.id`, `${ORDERS}.slots.3.row.name`]);
    });
});

describe('a link by node reference', () => {
    it('should follow a re-pointed current', () => {
        // Arrange
        const app: Node = {
            component: 'panel',
            children: {
                orders: { component: 'records', children: { detail: { component: 'descriptionList', '<-value': '^orders.current.customer' } } }
            }
        };
        const { links } = extract(app);
        const store = createStore<Record<string, unknown>>({
            data: { orders: { k1: { customer: 'Ada' }, k2: { customer: 'Grace' } } },
            app: { children: { orders: { children: { detail: {} } } } },
            runtime: { nodes: { app: { children: { orders: {} } } } }
        });
        store.link(`${ORDERS}.current`, '$.data.orders.k1');

        // Act
        const errors = applyLinks(store, links);
        const first = store.get('$.app.children.orders.children.detail.value');
        store.link(`${ORDERS}.current`, '$.data.orders.k2');

        // Assert
        expect(errors).toEqual([]);
        expect(first).toBe('Ada');
        expect(store.get('$.app.children.orders.children.detail.value')).toBe('Grace');
    });
});
