// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateNode } from '../core/shape/index.js';
import type { BuildError } from '../core/errors/index.js';
import type { JsonValue, Node } from '../core/types.js';
import type { Catalog } from './catalog.js';

const CATALOG = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'expected', 'catalog.json');

async function load(): Promise<Catalog> {
    return JSON.parse(await readFile(CATALOG, 'utf8')) as Catalog;
}

/** Validates every node of a tree against the catalog, with nothing but the catalog: no DOM, no build */
function validateTree(catalog: Catalog, node: Node, path: string): BuildError[] {
    const entry = catalog.components.find((candidate) => candidate.name === node.component);
    if (entry?.tier !== 'root') return [];
    const errors = validateNode(entry.shape, node, path);
    for (const slot of entry.slots) {
        const child = node[slot.name] as JsonValue | undefined;
        if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
            errors.push(...validateTree(catalog, child as Node, `${path}.${slot.name}`));
        }
    }
    return errors;
}

describe('catalog.json under plain node', () => {
    it('should load without a DOM', async () => {
        const catalog = await load();

        expect(typeof document).toBe('undefined');
        expect(catalog.components.map((entry) => entry.name)).toEqual(['fieldRow', 'loginForm', 'textLabel']);
    });

    it('should accept a document that follows the catalog', async () => {
        const catalog = await load();
        const app: Node = { component: 'fieldRow', label: { component: 'textLabel', _text: 'Name', color: 'red' } };

        expect(validateTree(catalog, app, '$.app')).toEqual([]);
    });

    it('should report the state path of a property the catalog does not know', async () => {
        const catalog = await load();
        const app: Node = { component: 'fieldRow', label: { component: 'textLabel', _text: 'Name', size: 3 } };

        const errors = validateTree(catalog, app, '$.app');

        expect(errors).toEqual([expect.objectContaining({ code: 'SUI-STATE-UNKNOWN', statePath: '$.app.label.size' })]);
    });

    it('should accept the example node of every root component', async () => {
        const catalog = await load();

        for (const entry of catalog.components) {
            if (entry.tier === 'root') expect(validateNode(entry.shape, entry.example, '$.app')).toEqual([]);
        }
    });
});
