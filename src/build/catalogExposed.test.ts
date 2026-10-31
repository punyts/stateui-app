import { describe, expect, it } from 'vitest';
import { parseShape } from '../core/shape/index.js';
import type { Shape } from '../core/shape/index.js';
import { emitCatalog, rootEntry } from './catalog.js';

describe('catalog entry with exposed runtime properties', () => {
    it('should mark the exposed property in the shape the catalog carries', () => {
        // Arrange
        const result = parseShape(
            {
                summary: 'A record list',
                properties: {
                    current: { type: 'any', runtime: true, exposed: true, default: {} },
                    status: { type: 'string', runtime: true, default: '' }
                }
            },
            'list.state.json'
        );
        const entry = rootEntry({ name: 'list', tier: 'root', tag: 'ui-list', group: 'composites', files: {}, locales: {} }, result.shape as Shape, 'composite');

        // Act
        const written = JSON.parse(emitCatalog([entry]).text) as { components: { shape: Shape }[] };

        // Assert
        expect(written.components[0]?.shape.properties.current?.exposed).toBe(true);
        expect(written.components[0]?.shape.properties.status?.exposed).toBe(false);
    });
});
