import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseShape, validateNode } from '../core/shape/index.js';
import type { PropertyShape, Shape } from '../core/shape/index.js';
import type { ScannedComponent } from '../core/convention/index.js';
import type { Node } from '../core/types.js';
import { composedEntry, emitCatalog, exampleNode, rootEntry, sizeOf } from './catalog.js';
import type { CatalogShape, ComponentCatalogEntry } from './catalog.js';
import { buildLibrary } from './index.js';

const temporary: string[] = [];

async function library(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'stateui-app-catalog-'));
    temporary.push(dir);
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), text, 'utf8');
    }
    return dir;
}

function parsed(input: unknown): Shape {
    const result = parseShape(input, 'x.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

function scanned(name: string, group = 'atoms', locales: Record<string, string> = {}): ScannedComponent {
    return { name, tier: 'root', tag: `ui-${name}`, group, files: {}, locales };
}

afterEach(async () => {
    for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('sizeOf', () => {
    it.each([
        ['atoms', 'atom'],
        ['components/molecules', 'molecule'],
        ['composites', 'composite'],
        ['components/composed', 'composite'],
        ['molecules/atoms', 'atom']
    ])('should give %s the size %s', (group, size) => {
        expect(sizeOf(group)).toBe(size);
    });

    it('should give no size to an unknown or empty group', () => {
        expect(sizeOf('g')).toBeUndefined();
        expect(sizeOf('')).toBeUndefined();
        expect(sizeOf('constructor')).toBeUndefined();
    });
});

describe('rootEntry', () => {
    const shape = parsed({
        summary: 'A data table',
        layout: true,
        events: ['sort'],
        commands: ['reset'],
        properties: {
            _title: { type: 'string', kind: 'content', required: true },
            body: { type: 'node' },
            columns: {
                type: 'map',
                items: { _header: { type: 'string', kind: 'content' }, cell: { type: 'node', row: true } }
            },
            width: { type: 'string', values: ['s', 'm'], required: true },
            count: { type: 'integer', required: true, validators: { range: { min: 2 } } }
        }
    });

    it('should describe content properties, slots, events, commands, layout and locales', () => {
        const entry = rootEntry(scanned('table', 'molecules', { de: 'a', fr: 'b' }), shape, 'molecule');

        expect(entry).toMatchObject({
            name: 'table',
            tier: 'root',
            size: 'molecule',
            summary: 'A data table',
            content: ['_title', 'columns._header'],
            slots: [
                { name: 'body', row: false },
                { name: 'columns.cell', row: true }
            ],
            events: ['sort'],
            commands: ['reset'],
            layout: true,
            locales: ['de', 'fr']
        });
        expect(entry.shape.properties.width?.values).toEqual(['s', 'm']);
    });

    it('should give an example with the required properties that passes validation', () => {
        const example = exampleNode('table', shape);

        expect(example).toEqual({ component: 'table', _title: 'x', width: 's', count: 2 });
        expect(validateNode(shape, example, '$.app')).toEqual([]);
    });

    it('should use the default of a required property in the example', () => {
        const withDefault = parsed({ summary: 'x', properties: { mode: { type: 'string', required: true, default: 'a' } } });

        expect(exampleNode('t', withDefault)).toEqual({ component: 't', mode: 'a' });
    });

    it('should carry tokens, placement and exposes when the shape declares them', () => {
        const area = parsed({ summary: 'x', properties: { area: { type: 'string' } } }).properties.area as PropertyShape;
        const declared: CatalogShape = {
            ...shape,
            tokens: [{ path: 'table.gap', group: 'table', type: 'dimension', default: '{space.gap.md}' }],
            placement: { area },
            exposes: { columns: 'The columns' }
        };

        const entry = rootEntry(scanned('table'), declared, 'atom');

        expect(entry.tokens).toEqual([{ path: 'table.gap', group: 'table', type: 'dimension', default: '{space.gap.md}' }]);
        expect(entry.placement).toEqual({ area });
        expect(entry.exposes).toEqual({ columns: 'The columns' });
        expect(Object.keys(entry.shape)).toEqual(['summary', 'properties', 'shared', 'events', 'commands', 'layout', 'tokens']);
    });

    it('should leave the optional keys out when the shape does not declare them', () => {
        const keys = Object.keys(rootEntry(scanned('table'), shape, 'atom'));

        for (const key of ['tokens', 'placement', 'exposes']) expect(keys).not.toContain(key);
    });
});

describe('shared and own properties', () => {
    it('should list the shared properties and the own ones separately', () => {
        const declared = parsed({
            summary: 'x',
            properties: { width: { type: 'string', values: ['narrow', 'wide'] } },
            shared: { tone: { default: 'accent' }, size: {} }
        });

        const entry = rootEntry(scanned('table'), declared, 'atom');

        expect(entry.shared).toEqual(['tone', 'size', 'hidden']);
        expect(entry.own).toEqual(['width']);
        expect(Object.keys(entry.shape.properties)).toEqual(['width', 'tone', 'size', 'hidden']);
    });

    it('should list hidden as the only shared property of a shape that declares none', () => {
        const entry = rootEntry(scanned('table'), parsed({ summary: 'x' }), 'atom');

        expect(entry.shared).toEqual(['hidden']);
        expect(entry.own).toEqual([]);
    });
});

describe('composedEntry', () => {
    it('should keep the default tree and move exposes to the entry', () => {
        const tree = { component: 'card', body: { component: 'text' }, exposes: { body: 'The body' } } as Node;

        const entry = composedEntry({ ...scanned('panel', 'composed'), tier: 'composed' }, tree, 'composite');

        expect(entry).toMatchObject({ name: 'panel', tier: 'composed', size: 'composite', tree: { component: 'card', body: { component: 'text' } } });
        expect('exposes' in (entry.tree as Record<string, unknown>)).toBe(false);
        expect(entry.exposes).toEqual({ body: 'The body' });
    });
});

describe('emitCatalog', () => {
    it('should sort entries by name and give the same text for any input order', () => {
        const entries: ComponentCatalogEntry[] = ['zeta', 'alpha', 'mid'].map((name) =>
            rootEntry(scanned(name), parsed({ summary: name }), 'atom')
        );

        const first = emitCatalog(entries);
        const second = emitCatalog([...entries].reverse());

        expect(first.catalog.components.map((entry) => entry.name)).toEqual(['alpha', 'mid', 'zeta']);
        expect(second.text).toBe(first.text);
        expect(first.text.endsWith('}\n')).toBe(true);
    });
});

describe('catalog.json from buildLibrary', () => {
    const SHAPE = '{ "summary": "A test component" }';

    it('should write the same catalog that the result holds, with the composed default tree', async () => {
        const source = await library({
            'atoms/one/one.view.html': '<p></p>',
            'atoms/one/one.state.json': SHAPE,
            'atoms/one/one.locale.de.json': '{}',
            'composites/two/two.composed.json': '{ "component": "one", "exposes": { "x": "y" } }'
        });
        const out = await library({});

        const result = await buildLibrary(source, out);

        const written = JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8'));
        expect(result.errors).toEqual([]);
        expect(written).toEqual(JSON.parse(JSON.stringify(result.catalog)));
        expect(written.components.map((entry: { name: string }) => entry.name)).toEqual(['one', 'two']);
        expect(written.components[0]).toMatchObject({ size: 'atom', locales: ['de'] });
        expect(written.components[1]).toMatchObject({ tier: 'composed', tree: { component: 'one' }, exposes: { x: 'y' } });
    });

    it('should leave out a component whose shape has no summary and report the file', async () => {
        const source = await library({
            'atoms/good/good.view.html': '<p></p>',
            'atoms/good/good.state.json': SHAPE,
            'atoms/bad/bad.view.html': '<p></p>',
            'atoms/bad/bad.state.json': '{ "properties": {} }'
        });

        const result = await buildLibrary(source, await library({}));

        expect(result.errors).toEqual([expect.objectContaining({ code: 'SUI-BUILD-SUMMARY', file: 'atoms/bad/bad.state.json' })]);
        expect(result.catalog.components.map((entry) => entry.name)).toEqual(['good']);
    });

    it('should leave out a component with a broken template and a composed file that is not a node', async () => {
        const source = await library({
            'atoms/broken/broken.view.html': '<p></div>',
            'atoms/broken/broken.state.json': SHAPE,
            'composites/odd/odd.composed.json': '[]',
            'composites/bad/bad.composed.json': '{',
            'composites/fine/fine.composed.json': '{ "component": "broken" }'
        });

        const result = await buildLibrary(source, await library({}));

        expect(result.errors.map((error) => error.file).sort()).toEqual([
            'atoms/broken/broken.view.html',
            'composites/bad/bad.composed.json',
            'composites/odd/odd.composed.json'
        ]);
        expect(result.catalog.components.map((entry) => entry.name)).toEqual(['fine']);
    });

    it('should fail a component that sits outside an atoms, molecules or composites folder', async () => {
        const source = await library({
            'misc/one/one.view.html': '<p></p>',
            'misc/one/one.state.json': SHAPE,
            'misc/two/two.composed.json': '{ "component": "one" }'
        });

        const result = await buildLibrary(source, await library({}));

        expect(result.errors.map((error) => error.file)).toEqual(['misc/one/one.view.html', 'misc/two/two.composed.json']);
        expect(result.catalog.components).toEqual([]);
        expect(result.built).toEqual([]);
    });
});
