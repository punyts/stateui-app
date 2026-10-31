import { describe, expect, it } from 'vitest';
import { resolveNode } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { Node } from '../types.js';
import { findRowProvider, parseTarget, resolveTarget, validateOn } from './index.js';
import type { Frame } from './index.js';

function shapeOf(properties: Record<string, unknown>, events: string[] = [], commands: string[] = []): Shape {
    const result = parseShape({ summary: 'Test', properties, events, commands }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const LIBRARY: ComponentLibrary = {
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({}) },
    button: { tier: 'root', tag: 'ui-button', shape: shapeOf({ pressed: { type: 'boolean', default: false } }, ['press']) },
    records: {
        tier: 'root',
        tag: 'ui-records',
        shape: shapeOf(
            {
                picked: { type: 'string', default: '' },
                row: { type: 'node', row: true },
                header: { type: 'node' },
                columns: { type: 'map', items: { cell: { type: 'node', row: true } }, default: {} }
            },
            [],
            ['delete']
        )
    }
};

function check(app: Node): [string, string | undefined][] {
    const resolved = resolveNode(app, LIBRARY);
    expect(resolved.errors).toEqual([]);
    return validateOn(resolved, LIBRARY).map((error) => [error.code, error.statePath]);
}

const records = (extra: Record<string, unknown>): Node =>
    ({ component: 'panel', children: { orders: { component: 'records', ...extra } } }) as Node;
const press = (on: unknown): Node => ({ component: 'button', on }) as Node;

describe('$row targets', () => {
    it('should parse $row and $row.path and refuse empty steps', () => {
        expect(parseTarget('$row')).toEqual({ form: 'row', segments: [] });
        expect(parseTarget('$row.customer.id')).toEqual({ form: 'row', segments: ['customer', 'id'] });
        expect(parseTarget('$row.')).toBeUndefined();
        expect(parseTarget('$row..x')).toBeUndefined();
    });

    it('should resolve $row to the row alias only when a row path is given', () => {
        // Arrange
        const parsed = parseTarget('$row.id');
        const chain: Frame[] = [{ path: '$.app', key: 'app', node: { component: 'panel' }, instances: [] }];

        // Act
        const inside = parsed ? resolveTarget(parsed, chain, '$.app', '$.runtime.nodes.app.slots.1.row') : undefined;
        const outside = parsed ? resolveTarget(parsed, chain, '$.app') : undefined;

        // Assert
        expect(inside).toEqual({ kind: 'state', path: '$.runtime.nodes.app.slots.1.row.id' });
        expect(outside).toBeUndefined();
    });

    it('should find the owner that declares a command, the owner included', () => {
        const owner: Frame = { path: '$.app.orders', key: 'orders', node: { component: 'records' }, instances: [] };
        const root: Frame = { path: '$.app', key: 'app', node: { component: 'panel' }, instances: [] };

        expect(findRowProvider([root, owner], (frame) => frame.node.component === 'records')).toBe(owner);
        expect(findRowProvider([root, owner], () => false)).toBeUndefined();
    });
});

describe('validateOn inside and outside a row template', () => {
    it('should accept $row as a set target, a set value and a command target inside a row template', () => {
        const app = records({
            row: press({
                press: [
                    { command: 'set', target: '$.data.selected', value: '$row.id' },
                    { command: 'set', target: '$row.seen', value: true },
                    { command: 'delete', target: '$row' }
                ]
            })
        });

        expect(check(app)).toEqual([]);
    });

    it('should accept $row inside a map-item node field that is a row template', () => {
        const app = records({ columns: { act: { cell: press({ press: { command: 'delete', target: '$row' } }) } } });

        expect(check(app)).toEqual([]);
    });

    it('should report $row outside a row template', () => {
        const app = records({
            header: press({ press: { command: 'set', target: '$row.x', value: 1 } }),
            row: press({ press: { command: 'delete', target: '$row.x' } })
        });
        const plain: Node = { component: 'panel', children: { b: press({ press: { command: 'toggle', target: '$row.pressed' } }) } };

        expect(check(app)).toEqual([
            ['SUI-ON-TARGET', '$.app.children.orders.header.on.press'],
            ['SUI-ON-TARGET', '$.app.children.orders.row.on.press']
        ]);
        expect(check(plain)).toEqual([['SUI-ON-TARGET', '$.app.children.b.on.press']]);
    });

    it('should report a $row command that no owner declares', () => {
        const app = records({ row: press({ press: { command: 'archive', target: '$row' } }) });

        expect(check(app)).toEqual([['SUI-ON-TARGET', '$.app.children.orders.row.on.press']]);
    });

    it('should resolve relative targets in a row template against the owning node', () => {
        // Arrange
        const ok = records({
            row: press({
                press: [
                    { command: 'set', target: '.picked', value: 'x' },
                    { command: 'set', target: '^orders.picked', value: 'x' }
                ]
            })
        });
        const bad = records({ row: press({ press: { command: 'toggle', target: '.pressed' } }) });

        // Act and assert
        expect(check(ok)).toEqual([]);
        expect(check(bad)).toEqual([['SUI-ON-TARGET', '$.app.children.orders.row.on.press']]);
    });
});
