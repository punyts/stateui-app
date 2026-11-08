import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLibrary } from './index.js';
import type { BuildResult } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIBRARY = join(HERE, 'fixtures', 'pattern-library');
const PATTERNS = join(HERE, 'fixtures', 'patterns');
const FIXTURE = join(HERE, 'fixtures', 'library');
const EXPECTED = join(HERE, 'fixtures', 'expected');

const temporary: string[] = [];

async function scratch(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'stateui-app-patterns-'));
    temporary.push(dir);
    return dir;
}

/** The fixture patterns plus the given files, in a scratch folder */
async function patternsWith(files: Record<string, string>): Promise<string> {
    const dir = await scratch();
    await cp(PATTERNS, dir, { recursive: true });
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), text, 'utf8');
    }
    return dir;
}

async function build(patternsDir: string): Promise<BuildResult> {
    return buildLibrary(LIBRARY, await scratch(), { patternsDir });
}

const GOOD_SCREEN = Object.freeze({
    summary: 'A screen with one caption',
    purposes: ['show one caption', 'put a line on a screen', 'start an empty screen'],
    tree: { component: 'stack', children: { line: { component: 'caption' } } }
});

function screen(overrides: Record<string, unknown>): string {
    return JSON.stringify({ ...GOOD_SCREEN, ...overrides });
}

afterEach(async () => {
    for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('buildLibrary with patternsDir', () => {
    it('should emit the good screens, sorted by kind then name, with the components they use', async () => {
        // Arrange and Act
        const result = await build(PATTERNS);

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.catalog.patterns.map((entry) => [entry.kind, entry.name, entry.components])).toEqual([
            ['screen', 'item-list', ['caption', 'stack']],
            ['screen', 'top-bar', ['caption', 'stack']]
        ]);
        const [itemList] = result.catalog.patterns;
        expect(itemList).toEqual({
            name: 'item-list',
            kind: 'screen',
            summary: 'A heading over a list of items',
            purposes: ['list the items of a dataset', 'show records under a heading', 'browse a collection'],
            tree: { component: 'stack', _title: 'Items', children: { list: { component: 'caption', '<-items': '$.data.items' } } },
            slots: { list: { path: 'children.list', description: 'The list of items' } },
            params: {
                title: { type: 'string', default: 'Items', paths: ['_title'], description: 'The heading' },
                items: { type: 'path', required: true, paths: ['children.list.<-items'], description: 'The dataset of items' }
            },
            components: ['caption', 'stack']
        });
    });

    it('should write the patterns to catalog.json', async () => {
        // Arrange
        const out = await scratch();

        // Act
        await buildLibrary(LIBRARY, out, { patternsDir: PATTERNS });

        // Assert
        const catalog = JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8')) as { patterns: { name: string }[] };
        expect(catalog.patterns.map((entry) => entry.name)).toEqual(['item-list', 'top-bar']);
    });

    it.each([
        ['a file outside a pattern folder', 'screen/loose.pattern.json', 'must be at <kind>/<name>/<name>.pattern.json'],
        ['a file too deep', 'screen/a/b/b.pattern.json', 'must be at <kind>/<name>/<name>.pattern.json'],
        ['a kind folder other than screen', 'widget/thing/thing.pattern.json', 'is in the folder "widget"; the kind folders are "screen"'],
        ['a folder name that is not lower-case hyphenated', 'screen/itemGrid/itemGrid.pattern.json', 'is in the folder "itemGrid", which is not a lower-case hyphenated name'],
        ['a file not named after its folder', 'screen/grid/list.pattern.json', 'must be named "grid.pattern.json" after its folder']
    ])('should report %s as SUI-PATTERN-FILE with the file', async (_label, file, reason) => {
        // Arrange
        const dir = await patternsWith({ [file]: screen({}) });

        // Act
        const result = await build(dir);

        // Assert
        expect(result.errors.map((error) => [error.code, error.file, error.message])).toEqual([['SUI-PATTERN-FILE', file, `Pattern file ${file} ${reason}`]]);
        expect(result.catalog.patterns.map((entry) => entry.name)).toEqual(['item-list', 'top-bar']);
    });

    it('should report a file that is not JSON', async () => {
        // Arrange
        const dir = await patternsWith({ 'screen/broken/broken.pattern.json': '{ "summary": ' });

        // Act
        const result = await build(dir);

        // Assert
        expect(result.errors.map((error) => error.message)).toEqual(['Pattern file screen/broken/broken.pattern.json could not be read as JSON']);
    });

    it('should report a pattern readPattern refuses and leave it out', async () => {
        // Arrange
        const file = 'screen/no-summary/no-summary.pattern.json';
        const dir = await patternsWith({ [file]: screen({ summary: undefined }) });

        // Act
        const result = await build(dir);

        // Assert
        expect(result.errors.map((error) => [error.code, error.file])).toEqual([['SUI-PATTERN-SHAPE', file]]);
        expect(result.catalog.patterns.map((entry) => entry.name)).toEqual(['item-list', 'top-bar']);
    });

    it('should check a pattern against the built library and leave it out on a problem', async () => {
        // Arrange
        const file = 'screen/carousel/carousel.pattern.json';
        const dir = await patternsWith({ [file]: screen({ tree: { component: 'carousel' } }) });

        // Act
        const result = await build(dir);

        // Assert
        expect(result.errors.map((error) => [error.code, error.file, error.message])).toEqual([
            ['SUI-PATTERN-SHAPE', file, `Pattern ${file} is not valid at $.tree: component "carousel" is not in the library`]
        ]);
        expect(result.catalog.patterns.map((entry) => entry.name)).toEqual(['item-list', 'top-bar']);
    });

    it('should report a purpose two patterns share and leave out the later one', async () => {
        // Arrange
        const file = 'screen/repeat/repeat.pattern.json';
        const dir = await patternsWith({ [file]: screen({ purposes: ['Browse a  collection', 'x y', 'z w'] }) });

        // Act
        const result = await build(dir);

        // Assert
        expect(result.errors.map((error) => [error.code, error.file])).toEqual([['SUI-BUILD-PURPOSE-DUPLICATE', file]]);
        expect(result.catalog.patterns.map((entry) => entry.name)).toEqual(['item-list', 'top-bar']);
    });
});

describe('buildLibrary without patternsDir', () => {
    it('should emit patterns: [] and otherwise the committed catalog', async () => {
        // Arrange
        const out = await scratch();

        // Act
        const result = await buildLibrary(FIXTURE, out);

        // Assert
        expect(result.catalog.patterns).toEqual([]);
        const actual = JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8')) as Record<string, unknown>;
        const expected = JSON.parse(await readFile(join(EXPECTED, 'catalog.json'), 'utf8')) as Record<string, unknown>;
        expect(actual).toEqual({ ...expected, patterns: [] });
    });
});
