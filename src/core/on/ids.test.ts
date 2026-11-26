import { describe, expect, it } from 'vitest';
import { extractLinks } from '../links/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { resolveNode } from '../resolve/index.js';
import { parseShape, validateNode } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { Node } from '../types.js';
import { checkTree } from '../validate/tree.js';
import { parseTarget } from './index.js';

function shapeOf(properties: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', properties }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const FIELD = shapeOf({ value: { type: 'string', default: '' }, label: { type: 'string', default: '' } });
const LIBRARY: ComponentLibrary = {
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({}) },
    field: { tier: 'root', tag: 'ui-field', shape: FIELD }
};

function resolved(app: Node) {
    const result = resolveNode(app, LIBRARY);
    expect(result.errors).toEqual([]);
    return result;
}

describe('ids and #name references', () => {
    it('should read #name.path as a named target', () => {
        // Arrange
        const text = '#signIn.busy';

        // Act
        const target = parseTarget(text);

        // Assert
        expect(target).toEqual({ form: 'named', name: 'signIn', segments: ['busy'] });
    });

    it('should no longer read the old ^name form', () => {
        // Arrange
        const text = '^signIn.busy';

        // Act
        const target = parseTarget(text);

        // Assert
        expect(target).toBeUndefined();
    });

    it('should resolve #name to the node whose @id it is, wherever the node is keyed', () => {
        // Arrange
        const app: Node = {
            component: 'panel',
            children: {
                form: { component: 'panel', children: { email: { component: 'field', '@id': 'username' } } },
                echo: { component: 'field', '<-value': '#username.value' }
            }
        };
        const tree = resolved(app);

        // Act
        const result = extractLinks(tree.node, { library: LIBRARY, instances: tree.instances });

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.links.map((link) => link.target)).toEqual(['$.app.children.form.children.email.value']);
    });

    it('should name a node with an @id by that id only, not by its key', () => {
        // Arrange
        const app: Node = {
            component: 'panel',
            children: {
                email: { component: 'field', '@id': 'username' },
                echo: { component: 'field', '<-value': '#email.value' }
            }
        };
        const tree = resolved(app);

        // Act
        const result = extractLinks(tree.node, { library: LIBRARY, instances: tree.instances });

        // Assert
        expect(result.errors.map((error) => error.code)).toEqual(['SUI-LINK-MISSING']);
    });

    it('should accept the metadata keys a definition may carry and refuse values that do not fit', () => {
        // Arrange
        const node: Node = {
            component: 'field',
            '@id': 'password',
            '@secret': ['value'],
            '@transient': true,
            '@local': ['nothing'],
            '@other': true
        };

        // Act
        const errors = validateNode(FIELD, node, '$.app');

        // Assert
        expect(errors.map((error) => `${error.code} ${error.statePath}`)).toEqual(['SUI-NODE-META $.app.@local', 'SUI-NODE-NAME $.app.@other']);
    });

    it('should refuse an @id that two nodes of one tree carry', () => {
        // Arrange
        const app: Node = {
            component: 'panel',
            children: {
                first: { component: 'field', '@id': 'name' },
                second: { component: 'field', '@id': 'name' }
            }
        };
        const tree = resolved(app);

        // Act
        const errors = checkTree(tree.node, tree.instances, '$.app', LIBRARY, undefined, {});

        // Assert
        expect(errors.map((error) => `${error.code} ${error.statePath}`)).toEqual(['SUI-NODE-ID-TWICE $.app.children.second']);
    });
});
