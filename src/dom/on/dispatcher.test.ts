import { describe, expect, it } from 'vitest';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { Shape } from '../../core/shape/index.js';
import { componentTags } from './dispatcher.js';

function shapeOf(json: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Fixture', ...json }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

describe('componentTags', () => {
    it('should list the tag of each root component and none for a composed or a shape component', () => {
        // Arrange
        const library: ComponentLibrary = {
            button: { tier: 'root', tag: 'x-button', shape: shapeOf({ events: ['press'] }) },
            card: { tier: 'composed', tree: { component: 'button' } },
            dot: { tier: 'shape', shape: shapeOf({ properties: { r: { type: 'number', default: 1 } }, events: ['press'] }) }
        };

        // Act
        const tags = componentTags(library);

        // Assert
        expect([...tags]).toEqual(['x-button']);
    });
});
