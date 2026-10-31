// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateNode } from '../core/shape/index.js';
import type { Node } from '../core/types.js';
import { validateDocument } from '../core/validate/index.js';
import type { Catalog } from './catalog.js';

const CATALOG = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'expected', 'catalog.json');

async function load(): Promise<Catalog> {
    return JSON.parse(await readFile(CATALOG, 'utf8')) as Catalog;
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

        expect(validateDocument({ data: {}, app }, catalog)).toEqual({ valid: true, errors: [] });
    });

    it('should report the state path of a property the catalog does not know', async () => {
        const catalog = await load();
        const app: Node = { component: 'fieldRow', label: { component: 'textLabel', _text: 'Name', size: 3 } };

        const { errors } = validateDocument({ data: {}, app }, catalog);

        expect(errors).toEqual([expect.objectContaining({ code: 'SUI-STATE-SHARED', statePath: '$.app.label.size' })]);
    });

    it('should accept the example node of every root component', async () => {
        const catalog = await load();

        for (const entry of catalog.components) {
            if (entry.tier === 'root') expect(validateNode(entry.shape, entry.example, '$.app')).toEqual([]);
        }
    });
});
