import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateLayoutSheets } from '../dom/layout/index.js';
import { buildLibrary } from './index.js';
import { LAYOUT_SHEET_LINES, checkLayoutHost, hasLayoutHost, prependLayoutSheets } from './layoutSheets.js';

const temporary: string[] = [];

async function library(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'stateui-app-layout-'));
    temporary.push(dir);
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), text, 'utf8');
    }
    return dir;
}

const out = async (): Promise<string> => library({});

const shape = (layout: boolean): string =>
    JSON.stringify({ summary: 'A test component', properties: {}, ...(layout ? { layout: true } : {}) });

const view = (host: boolean): string => `<div${host ? ' layout-host=""' : ''}><slot></slot></div>`;

afterEach(async () => {
    for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('hasLayoutHost', () => {
    it.each([
        ['<div layout-host=""></div>', true],
        ['<div layout-host="" />', true],
        ['<div class="a" layout-host></div>', true],
        ['<div></div>', false],
        ['<div title="layout-host"></div>', false],
        ['<!-- <div layout-host=""></div> -->', false],
        ['<p>layout-host</p>', false]
    ])('should answer for %s', (text, expected) => {
        // Arrange and Act
        const found = hasLayoutHost(text);

        // Assert
        expect(found).toBe(expected);
    });
});

describe('checkLayoutHost', () => {
    it('should accept a layout shape with a layout host and a plain shape without one', () => {
        // Arrange and Act
        const both = checkLayoutHost(view(true), true, 'a.view.html');
        const neither = checkLayoutHost(view(false), false, 'a.view.html');

        // Assert
        expect(both).toEqual([]);
        expect(neither).toEqual([]);
    });

    it('should name the file when layout is supported and the view has no layout host', () => {
        // Arrange and Act
        const errors = checkLayoutHost(view(false), true, 'atoms/a/a.view.html');

        // Assert
        expect(errors).toHaveLength(1);
        expect(errors[0]?.code).toBe('SUI-BUILD-TEMPLATE');
        expect(errors[0]?.file).toBe('atoms/a/a.view.html');
    });

    it('should name the file when the view has a layout host and layout is not supported', () => {
        // Arrange and Act
        const errors = checkLayoutHost(view(true), false, 'atoms/a/a.view.html');

        // Assert
        expect(errors).toHaveLength(1);
        expect(errors[0]?.file).toBe('atoms/a/a.view.html');
    });
});

describe('prependLayoutSheets', () => {
    it('should put the layout sheets in front of the component CSS', () => {
        // Arrange
        const css = ':host { color: red; }';

        // Act
        const result = prependLayoutSheets(css, { component: 'a', file: 'a.view.css', tokens: [] });

        // Assert
        expect(result).toBe(`${generateLayoutSheets()}${css}`);
        expect(result.split('\n').length - 1).toBe(LAYOUT_SHEET_LINES);
    });
});

describe('buildLibrary with layout', () => {
    it('should add the layout sheets to a layout component and not to another', async () => {
        // Arrange
        const source = await library({
            'atoms/box/box.view.html': view(true),
            'atoms/box/box.state.json': shape(true),
            'atoms/plain/plain.view.html': view(false),
            'atoms/plain/plain.state.json': shape(false)
        });
        const target = await out();

        // Act
        const result = await buildLibrary(source, target);
        const box = await readFile(join(target, 'box.js'), 'utf8');
        const plain = await readFile(join(target, 'plain.js'), 'utf8');

        // Assert
        expect(result.errors).toEqual([]);
        expect(box).toContain('container-type: inline-size');
        expect(box).toContain('layout-collapse-below');
        expect(plain).not.toContain('layout-collapse-below');
    });

    it('should report a layout component without a layout host and name the view file', async () => {
        // Arrange
        const source = await library({ 'atoms/box/box.view.html': view(false), 'atoms/box/box.state.json': shape(true) });

        // Act
        const result = await buildLibrary(source, await out());

        // Assert
        expect(result.errors.map((error) => error.file)).toEqual(['atoms/box/box.view.html']);
        expect(result.built).toEqual([]);
    });

    it('should report a layout host in a component whose shape does not support layout', async () => {
        // Arrange
        const source = await library({ 'atoms/box/box.view.html': view(true), 'atoms/box/box.state.json': shape(false) });

        // Act
        const result = await buildLibrary(source, await out());

        // Assert
        expect(result.errors.map((error) => error.file)).toEqual(['atoms/box/box.view.html']);
    });

    it('should report a style error on the line of the file after the layout sheets', async () => {
        // Arrange
        const source = await library({
            'atoms/box/box.view.html': view(true),
            'atoms/box/box.state.json': shape(true),
            'atoms/box/box.view.css': 'p { color: red; }\np { color: {{ $.a }}'
        });

        // Act
        const result = await buildLibrary(source, await out());
        

        // Assert
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ file: 'atoms/box/box.view.css', line: 2 });
    });
});
