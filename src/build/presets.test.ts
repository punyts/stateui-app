import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLibrary, buildPresets } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIBRARY = join(HERE, 'fixtures', 'pattern-library');
const PRESETS = join(HERE, 'fixtures', 'presets');

const temporary: string[] = [];

async function scratch(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'stateui-app-presets-'));
    temporary.push(dir);
    return dir;
}

/** The fixture presets plus the given files, in a scratch folder */
async function presetsWith(files: Record<string, string>): Promise<string> {
    const dir = await scratch();
    await cp(PRESETS, dir, { recursive: true });
    for (const [path, text] of Object.entries(files)) await writeFile(join(dir, path), text, 'utf8');
    return dir;
}

const preset = (body: object): string => JSON.stringify(body);
const GOOD = Object.freeze({ summary: 'Another preset', tokens: { radius: { md: '4px' } } });

afterEach(async () => {
    await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('buildLibrary with presetsDir', () => {
    it('should put each preset that passes in the catalog as themePresets, sorted by name, with its overlays', async () => {
        // Arrange
        const presetsDir = await presetsWith({ 'airy.preset.json': preset(GOOD) });

        // Act
        const out = await scratch();
        const result = await buildLibrary(LIBRARY, out, { presetsDir });

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.catalog.themePresets.map((entry) => entry.name)).toEqual(['airy', 'plain']);
        const plain = result.catalog.themePresets[1]!;
        expect(plain.summary).toContain('plain fixture preset');
        expect(plain.overlays['dark']).toMatchObject({ kind: 'mode' });
        const written = JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8')) as { themePresets: unknown[] };
        expect(written.themePresets).toEqual(result.catalog.themePresets);
    });

    it('should emit themePresets: [] without presetsDir', async () => {
        // Act
        const result = await buildLibrary(LIBRARY, await scratch());

        // Assert
        expect(result.catalog.themePresets).toEqual([]);
    });
});

describe('buildPresets', () => {
    it.each([
        ['an unknown token', { summary: 'Bad', tokens: { colour: { accent: '#fff' } } }, 'SUI-THEME'],
        ['a value of the wrong type', { summary: 'Bad', tokens: { radius: { md: 'round' } } }, 'SUI-THEME'],
        ['a missing summary', { tokens: {} }, 'SUI-PRESET-SHAPE'],
        ['a summary on two lines', { summary: 'One\ntwo', tokens: {} }, 'SUI-PRESET-SHAPE'],
        ['an unknown key', { summary: 'Bad', tokens: {}, mode: 'dark' }, 'SUI-PRESET-SHAPE'],
        ['an overlay of an unknown kind', { summary: 'Bad', tokens: {}, overlays: { night: { kind: 'season', tokens: {} } } }, 'SUI-PRESET-SHAPE'],
        ['an overlay outside its groups', { summary: 'Bad', tokens: {}, overlays: { night: { kind: 'mode', tokens: { radius: { md: '2px' } } } } }, 'SUI-THEME-OVERLAY']
    ])('should fail the build and leave out a preset with %s, naming its file', async (_case, body, code) => {
        // Arrange
        const presetsDir = await presetsWith({ 'broken.preset.json': preset(body) });

        // Act
        const result = await buildPresets(presetsDir);

        // Assert
        expect(result.themePresets.map((entry) => entry.name)).toEqual(['plain']);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.every((error) => error.file === 'broken.preset.json')).toBe(true);
        expect(result.errors[0]!.code.startsWith(code)).toBe(true);
    });

    it('should refuse a file with another name and a file that is not JSON as SUI-PRESET-FILE', async () => {
        // Arrange
        const presetsDir = await presetsWith({ 'Bold.preset.json': preset(GOOD), 'notes.json': preset(GOOD), 'cut.preset.json': '{ "summary": ' });

        // Act
        const result = await buildPresets(presetsDir);

        // Assert
        expect(result.themePresets.map((entry) => entry.name)).toEqual(['plain']);
        expect(result.errors.map((error) => [error.code, error.file])).toEqual([
            ['SUI-PRESET-FILE', 'Bold.preset.json'],
            ['SUI-PRESET-FILE', 'cut.preset.json'],
            ['SUI-PRESET-FILE', 'notes.json']
        ]);
    });
});
