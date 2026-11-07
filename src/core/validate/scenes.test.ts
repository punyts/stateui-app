import { describe, expect, it } from 'vitest';
import { STORE_LIBRARY } from '../assemble/fixtures/storeApp.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { JsonObject } from '../types.js';
import { MAX_SCENES_PER_PAGE, validateDocument } from './index.js';

function shapeOf(source: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', ...source }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

// A fixture scene and node: the real ones are in stateui-components
const LIBRARY: ComponentLibrary = Object.freeze({
    ...STORE_LIBRARY,
    scene3d: { tier: 'root', tag: 'ui-scene3d', shape: shapeOf({ childComponents: ['mesh'], properties: {} }) },
    mesh: { tier: 'shape', shape: shapeOf({ properties: { visible: { type: 'boolean', default: true } } }) }
});

/** `count` scenes, each with one mesh, keyed `s0`, `s1`, ... */
function scenes(count: number): JsonObject {
    const children: JsonObject = {};
    for (let index = 0; index < count; index += 1) children[`s${index}`] = { component: 'scene3d', children: { box: { component: 'mesh' } } };
    return children;
}

function warnings(document: JsonObject): { code: string; severity?: string; statePath?: string; message: string }[] {
    const result = validateDocument(document, LIBRARY);
    expect(result.errors.filter((error) => error.code !== 'SUI-DOC-LIMIT-SCENES')).toEqual([]);
    return result.errors.map(({ code, severity, statePath, message }) => ({ code, severity, statePath, message }));
}

describe('the scenes document validator (more than 16 scenes on a page)', () => {
    it('should say nothing about 16 scenes in the app tree', () => {
        // Act
        const found = warnings({ app: { component: 'panel', children: scenes(16) } });

        // Assert
        expect(MAX_SCENES_PER_PAGE).toBe(16);
        expect(found).toEqual([]);
    });

    it('should warn once, naming the count and the 16 WebGL contexts, for 17 scenes in the app tree', () => {
        // Act
        const result = validateDocument({ app: { component: 'panel', children: scenes(17) } }, LIBRARY);
        const found = warnings({ app: { component: 'panel', children: scenes(17) } });

        // Assert
        expect(result.valid).toBe(true);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ code: 'SUI-DOC-LIMIT-SCENES', severity: 'warning', statePath: '$.app' });
        expect(found[0]?.message).toContain('17 scene3d nodes');
        expect(found[0]?.message).toContain('at most 16 WebGL contexts per page');
        expect(found[0]?.message).toContain('_fallback');
    });

    it('should count scenes at any depth', () => {
        // Act
        const found = warnings({ app: { component: 'panel', children: { a: { component: 'panel', children: scenes(9) }, b: { component: 'panel', children: scenes(8) } } } });

        // Assert
        expect(found.map((warning) => [warning.code, warning.statePath])).toEqual([['SUI-DOC-LIMIT-SCENES', '$.app']]);
    });

    it('should count a page as the shell and one screen, and warn at the screen that is over', () => {
        // Arrange
        const document = {
            app: { component: 'page', children: { main: { component: 'outlet' }, ...scenes(2) } },
            screens: {
                light: { title: 'Light', root: { component: 'panel', children: scenes(14) } },
                heavy: { title: 'Heavy', root: { component: 'panel', children: scenes(15) } }
            },
            start: 'light'
        };

        // Act
        const found = warnings(document);

        // Assert
        expect(found.map((warning) => [warning.code, warning.statePath])).toEqual([['SUI-DOC-LIMIT-SCENES', '$.screens.heavy']]);
        expect(found[0]?.message).toContain('17 scene3d nodes');
    });
});
