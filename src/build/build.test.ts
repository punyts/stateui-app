import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildError } from '../core/errors/index.js';
import { buildLibrary } from './index.js';
import type { BuildOptions } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'library');
const EXPECTED = join(HERE, 'fixtures', 'expected');

const temporary: string[] = [];

async function scratch(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'stateui-app-build-'));
    temporary.push(dir);
    return dir;
}

async function library(files: Record<string, string>): Promise<string> {
    const dir = await scratch();
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), text, 'utf8');
    }
    return dir;
}

async function snapshot(dir: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const name of (await readdir(dir)).sort()) {
        result[name] = (await readFile(join(dir, name), 'utf8')).replaceAll('\r\n', '\n');
    }
    return result;
}

const SHAPE = '{ "summary": "A test component", "properties": { "text": { "type": "string", "default": "x" } } }';

function simple(name: string, view = '<p>{{ $.text }}</p>', extra: Record<string, string> = {}): Record<string, string> {
    return {
        [`atoms/${name}/${name}.view.html`]: view,
        [`atoms/${name}/${name}.state.json`]: SHAPE,
        ...extra
    };
}

afterEach(async () => {
    for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('buildLibrary', () => {
    it('should match the committed output when the fixture library is built', async () => {
        const out = await scratch();

        const result = await buildLibrary(FIXTURE, out);

        expect(result.errors).toEqual([]);
        expect(result.built.map((entry) => entry.component.name)).toEqual(['fieldRow', 'textLabel']);
        const actual = await snapshot(out);
        if (process.env.UPDATE_GOLDEN === '1') {
            await mkdir(EXPECTED, { recursive: true });
            for (const [name, text] of Object.entries(actual)) await writeFile(join(EXPECTED, name), text, 'utf8');
        }
        expect(actual).toEqual(await snapshot(EXPECTED));
    });

    it('should emit no module for a composed component and list catalog.json', async () => {
        const out = await scratch();

        const result = await buildLibrary(FIXTURE, out);

        expect(result.files).toEqual(['catalog.json', 'fieldRow.d.ts', 'fieldRow.js', 'index.d.ts', 'index.js', 'textLabel.d.ts', 'textLabel.js']);
    });

    it('should produce identical bytes when the same input is built twice', async () => {
        const first = await scratch();
        const second = await scratch();

        await buildLibrary(FIXTURE, first);
        await buildLibrary(FIXTURE, second);

        expect(await snapshot(second)).toEqual(await snapshot(first));
        expect(JSON.stringify(await snapshot(first))).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it('should set the shape defaults as the default state of the module', async () => {
        const out = await scratch();

        await buildLibrary(FIXTURE, out);

        const module = await readFile(join(out, 'textLabel.js'), 'utf8');
        expect(module).toContain('export const defaultState = {\n    "_text": "Hello",\n    "color": "black"\n};');
        expect(module).toContain('export const tag = "ui-text-label";');
    });

    it('should report one error and emit two modules when one template is broken', async () => {
        const source = await library({
            ...simple('good-one'),
            ...simple('good-two'),
            ...simple('broken', '<p>\n  <b>{{ $.text }}</p>')
        });
        const out = await scratch();

        const result = await buildLibrary(source, out);

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-TEMPLATE', file: 'atoms/broken/broken.view.html' });
        expect(result.errors[0]?.line).toBeTypeOf('number');
        expect(result.errors[0]?.column).toBeTypeOf('number');
        expect(result.built.map((entry) => entry.component.name)).toEqual(['goodOne', 'goodTwo']);
        expect(Object.keys(await snapshot(out))).toEqual(['catalog.json', 'goodOne.d.ts', 'goodOne.js', 'goodTwo.d.ts', 'goodTwo.js', 'index.d.ts', 'index.js']);
    });

    it('should report a template compile error with its file', async () => {
        const source = await library(simple('bad', '<p>{{ $.a + }}</p>'));

        const result = await buildLibrary(source, await scratch());

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-TEMPLATE', file: 'atoms/bad/bad.view.html' });
        expect(result.built).toEqual([]);
    });

    it('should report a style error with file and line', async () => {
        const source = await library(
            simple('styled', '<p>{{ $.text }}</p>', { 'atoms/styled/styled.view.css': 'p { color: red; }\np { color: {{ $.a }}' })
        );

        const result = await buildLibrary(source, await scratch());

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ file: 'atoms/styled/styled.view.css', line: 2 });
    });

    it('should report shape errors and still check the template of the same component', async () => {
        const source = await library({
            'atoms/odd/odd.view.html': '<p></div>',
            'atoms/odd/odd.state.json': '{ "properties": {} }'
        });

        const result = await buildLibrary(source, await scratch());

        expect(result.errors.map((error) => error.file).sort()).toEqual(['atoms/odd/odd.state.json', 'atoms/odd/odd.view.html']);
    });

    it('should report convention errors from the scan and build the rest', async () => {
        const source = await library({ ...simple('fine'), 'atoms/lonely/other.view.html': '<p></p>' });

        const result = await buildLibrary(source, await scratch());

        expect(result.errors.map((error) => error.code)).toEqual(['SUI-BUILD-ROLE']);
        expect(result.built.map((entry) => entry.component.name)).toEqual(['fine']);
    });

    it('should run cssTransforms in order before compiling and cssChecks on the file text', async () => {
        const source = await library(simple('themed', '<p>{{ $.text }}</p>', { 'atoms/themed/themed.view.css': 'p { color: TOKEN; }' }));
        const out = await scratch();
        const seen: string[] = [];
        const options: BuildOptions = {
            cssTransforms: [(css) => css.replace('TOKEN', 'STEP'), (css) => css.replace('STEP', 'red')],
            cssChecks: [
                (css, context) => {
                    seen.push(`${context.component}:${css}`);
                    return [];
                }
            ]
        };

        const result = await buildLibrary(source, out, options);

        expect(result.errors).toEqual([]);
        expect(seen).toEqual(['themed:p { color: TOKEN; }']);
        expect(await readFile(join(out, 'themed.js'), 'utf8')).toContain('p { color: red; }');
    });

    it('should fail a component when a cssCheck reports an error and keep its location', async () => {
        const source = await library(
            simple('tokens', '<p>{{ $.text }}</p>', { 'atoms/tokens/tokens.view.css': 'p { color: var(--ui-palette-red); }' })
        );
        const options: BuildOptions = {
            cssChecks: [(_css, context) => [buildError('SUI-BUILD-TOKEN', { file: context.file, token: '--ui-palette-red', line: 1, column: 18 })]]
        };

        const result = await buildLibrary(source, await scratch(), options);

        expect(result.errors).toEqual([
            expect.objectContaining({ code: 'SUI-BUILD-TOKEN', file: 'atoms/tokens/tokens.view.css', line: 1, column: 18 })
        ]);
        expect(result.built).toEqual([]);
    });

    it('should give byte-identical output with no extension points and with empty lists', async () => {
        const first = await scratch();
        const second = await scratch();

        await buildLibrary(FIXTURE, first);
        await buildLibrary(FIXTURE, second, { cssTransforms: [], cssChecks: [] });

        expect(await snapshot(second)).toEqual(await snapshot(first));
    });

    it('should compile a controller by path and import its default export', async () => {
        const source = await library(
            simple('active', '<p>{{ $.text }}</p>', {
                'atoms/active/active.controller.ts':
                    'interface Options { a: number }\nconst make = (): Options => ({ a: 1 });\nexport default function controller(): Options { return make(); }\n'
            })
        );
        const out = await scratch();

        const result = await buildLibrary(source, out);

        expect(result.errors).toEqual([]);
        expect(result.files).toContain('active.controller.js');
        const text = await readFile(join(out, 'active.js'), 'utf8');
        expect(text).toContain("import controller from './active.controller.js';");
        const js = await readFile(join(out, 'active.controller.js'), 'utf8');
        const compiled = (await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)) as { default: () => unknown };
        expect(compiled.default()).toEqual({ a: 1 });
    });

    it('should reject a controller that does not export exactly one default factory', async () => {
        const cases: Record<string, string> = {
            named: 'export const controller = () => ({});\n',
            two: 'export default () => ({});\nexport const extra = 1;\n',
            none: 'const a = 1;\n'
        };

        for (const [name, text] of Object.entries(cases)) {
            const source = await library(simple(name, '<p></p>', { [`atoms/${name}/${name}.controller.ts`]: text }));

            const result = await buildLibrary(source, await scratch());

            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]?.file).toBe(`atoms/${name}/${name}.controller.ts`);
            expect(result.built).toEqual([]);
        }
    });

    it('should locate a controller syntax error by line', async () => {
        const source = await library(simple('syntax', '<p></p>', { 'atoms/syntax/syntax.controller.ts': 'const a = 1;\nexport default (\n' }));

        const result = await buildLibrary(source, await scratch());

        expect(result.errors[0]).toMatchObject({ file: 'atoms/syntax/syntax.controller.ts' });
        expect(result.errors[0]?.line).toBeGreaterThanOrEqual(2);
    });

    it('should write an empty index when the library has no components', async () => {
        const out = await scratch();

        const result = await buildLibrary(await scratch(), out);

        expect(result.errors).toEqual([]);
        expect(result.files).toEqual(['catalog.json', 'index.d.ts', 'index.js']);
        expect(await readFile(join(out, 'index.js'), 'utf8')).toContain('export const components = [];');
    });
});

describe('buildLibrary locale overlays', () => {
    const CONTENT_SHAPE =
        '{ "summary": "A label", "properties": { "_text": { "type": "string", "kind": "content", "default": "Hello" }, "color": { "type": "string", "default": "black" } } }';

    function label(extra: Record<string, string> = {}): Record<string, string> {
        return {
            'atoms/label/label.view.html': '<p>{{ $._text }}</p>',
            'atoms/label/label.state.json': CONTENT_SHAPE,
            ...extra
        };
    }

    it('should write a valid root overlay to the output and list its language in the catalog', async () => {
        // Arrange
        const source = await library(
            label({
                'atoms/label/label.locale.de.json': '{ "_text": "Hallo" }',
                'atoms/label/label.locale.fr.json': '{ "_text": "Bonjour" }'
            })
        );
        const out = await scratch();

        // Act
        const result = await buildLibrary(source, out);

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.files).toContain('label.locale.de.json');
        expect(JSON.parse(await readFile(join(out, 'label.locale.de.json'), 'utf8'))).toEqual({ _text: 'Hallo' });
        expect(result.catalog.locales).toEqual(['de', 'fr']);
        expect(result.catalog.components[0]?.locales).toEqual(['de', 'fr']);
    });

    it('should report a property that is not content and give the component no module', async () => {
        // Arrange
        const source = await library(label({ 'atoms/label/label.locale.de.json': '{ "color": "schwarz", "_text": "Hallo" }' }));

        // Act
        const result = await buildLibrary(source, await scratch());

        // Assert
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ code: 'SUI-LOCALE-CONTENT', file: 'atoms/label/label.locale.de.json', statePath: '$.color' });
        expect(result.built).toEqual([]);
        expect(result.catalog.locales).toEqual([]);
    });

    it('should report a name the shape does not have and a file that is not an object', async () => {
        // Arrange
        const source = await library({
            ...label({ 'atoms/label/label.locale.de.json': '{ "_title": "x" }' }),
            ...simple('other', '<p>{{ $.text }}</p>', { 'atoms/other/other.locale.de.json': '[1]' })
        });

        // Act
        const result = await buildLibrary(source, await scratch());

        // Assert
        expect(result.errors.map((error) => [error.code, error.file])).toEqual([
            ['SUI-LOCALE-PATH', 'atoms/label/label.locale.de.json'],
            ['SUI-BUILD-SHAPE', 'atoms/other/other.locale.de.json']
        ]);
    });

    it('should check a composed overlay against the paths of the default tree', async () => {
        // Arrange
        const tree = '{ "component": "label", "_text": "Card", "other": { "component": "label", "_text": "More" } }';
        const source = await library({
            ...label(),
            'composites/card/card.composed.json': tree,
            'composites/card/card.locale.de.json': '{ "_text": "Karte", "other": { "_text": "Mehr" } }',
            'composites/broken/broken.composed.json': tree,
            'composites/broken/broken.locale.de.json': '{ "ghost": { "_text": "x" } }'
        });
        const out = await scratch();

        // Act
        const result = await buildLibrary(source, out);

        // Assert
        expect(result.errors.map((error) => [error.code, error.file, error.statePath])).toEqual([
            ['SUI-LOCALE-PATH', 'composites/broken/broken.locale.de.json', '$.ghost']
        ]);
        expect(result.catalog.components.map((entry) => entry.name)).toEqual(['card', 'label']);
        expect(result.files).toContain('card.locale.de.json');
        expect(result.files).not.toContain('broken.locale.de.json');
        expect(result.catalog.locales).toEqual(['de']);
    });
});
