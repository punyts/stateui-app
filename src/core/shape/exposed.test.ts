import { describe, expect, it } from 'vitest';
import { nodeChildren, parseShape } from './index.js';
import type { Shape } from './index.js';

function parse(properties: Record<string, unknown>) {
    return parseShape({ summary: 'x', properties }, 'records.state.json');
}

describe('exposed', () => {
    it('should mark an exposed runtime property', () => {
        // Arrange
        const result = parse({ current: { type: 'any', runtime: true, exposed: true, default: {} }, width: { type: 'string' } });

        // Act
        const shape = result.shape as Shape;

        // Assert
        expect(result.errors).toEqual([]);
        expect(shape.properties.current?.exposed).toBe(true);
        expect(shape.properties.width?.exposed).toBe(false);
    });

    it('should refuse exposed on a property that is not runtime', () => {
        const result = parse({ current: { type: 'any', exposed: true, default: {} } });

        expect(result.shape).toBeUndefined();
        expect(result.errors.map((error) => error.code)).toEqual(['SUI-BUILD-SHAPE']);
        expect(result.errors[0]?.message).toContain('properties.current.exposed');
    });

    it('should refuse an exposed value that is not a boolean', () => {
        const result = parse({ current: { type: 'any', runtime: true, exposed: 'yes', default: {} } });

        expect(result.errors.map((error) => error.code)).toEqual(['SUI-BUILD-SHAPE']);
    });
});

describe('nodeChildren', () => {
    const shape = parse({
        row: { type: 'node', row: true },
        header: { type: 'node' },
        columns: { type: 'map', items: { cell: { type: 'node', row: true }, plain: { type: 'node' } } }
    }).shape as Shape;

    it('should list children, slots and map-item node fields with their row flag', () => {
        // Arrange
        const node = {
            component: 'table',
            children: { a: { component: 'text' } },
            row: { component: 'text' },
            header: { component: 'text' },
            columns: { total: { cell: { component: 'text' }, plain: { component: 'text' }, title: 'x' } }
        };

        // Act
        const children = nodeChildren(node, '$.app', shape).map((child) => [child.path, child.row]);

        // Assert
        expect(children).toEqual([
            ['$.app.children.a', false],
            ['$.app.row', true],
            ['$.app.header', false],
            ['$.app.columns.total.cell', true],
            ['$.app.columns.total.plain', false]
        ]);
    });
});
