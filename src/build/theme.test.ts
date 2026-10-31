import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LEAVES, DEFAULT_TOKEN_DESCRIPTIONS, KIND_GROUPS, OVERLAY_KINDS } from '../core/theme/index.js';
import { buildLibrary } from './index.js';
import { buildThemeSection } from './theme.js';

const temporary: string[] = [];

async function library(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'stateui-app-theme-'));
    temporary.push(dir);
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), text, 'utf8');
    }
    return dir;
}

afterEach(async () => {
    for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('buildThemeSection', () => {
    const { theme, errors } = buildThemeSection();
    const semantic = DEFAULT_LEAVES.filter((leaf) => leaf.layer === 'semantic');

    it('should list every semantic token with path, type, default, group and description', () => {
        expect(errors).toEqual([]);
        expect(theme.tokens.map((token) => token.path)).toEqual(semantic.map((leaf) => leaf.path));
        expect(theme.tokens.find((token) => token.path === 'color.text.muted')).toEqual({
            path: 'color.text.muted',
            type: 'color',
            default: '{palette.neutral.600}',
            group: 'color',
            description: DEFAULT_TOKEN_DESCRIPTIONS['color.text.muted']
        });
        expect(theme.tokens.find((token) => token.path === 'radius.md')).toMatchObject({ type: 'dimension', default: '6px', group: 'radius' });
    });

    it('should leave out the primitive tokens', () => {
        const groups = new Set(theme.tokens.map((token) => token.group));

        for (const primitive of ['palette', 'scale', 'font']) expect(groups.has(primitive)).toBe(false);
        expect(groups).toEqual(new Set(['color', 'space', 'size', 'icon', 'radius', 'border', 'elevation', 'text', 'motion', 'density', 'focus']));
    });

    it('should describe every token in one line and have no description without a token', () => {
        for (const token of theme.tokens) expect(token.description, token.path).toMatch(/^[^\r\n]+$/);
        const known = new Set(semantic.map((leaf) => leaf.path));
        expect(Object.keys(DEFAULT_TOKEN_DESCRIPTIONS).filter((path) => !known.has(path))).toEqual([]);
    });

    it('should list the shipped overlays by kind with the groups the kind may touch', () => {
        expect(Object.keys(theme.overlays)).toEqual([...OVERLAY_KINDS]);
        expect(theme.overlays.mode.map((overlay) => overlay.name)).toEqual(['light', 'dark', 'contrast']);
        expect(theme.overlays.brand.map((overlay) => overlay.name)).toEqual(['default']);
        expect(theme.overlays.motion.map((overlay) => overlay.name)).toEqual(['full', 'reduced']);
        for (const kind of OVERLAY_KINDS) {
            for (const overlay of theme.overlays[kind]) expect(overlay.groups).toEqual([...KIND_GROUPS[kind]]);
        }
    });

    it('should report a token without a description and leave it out', () => {
        const without = Object.fromEntries(Object.entries(DEFAULT_TOKEN_DESCRIPTIONS).filter(([path]) => path !== 'color.focus'));

        const result = buildThemeSection({ descriptions: without });

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-TOKENDESC', file: 'tokens.descriptions.json' });
        expect(result.errors[0]?.message).toContain('color.focus');
        expect(result.theme.tokens.some((token) => token.path === 'color.focus')).toBe(false);
    });

    it('should report a blank or multi-line description', () => {
        const blank = buildThemeSection({ descriptions: { ...DEFAULT_TOKEN_DESCRIPTIONS, 'color.focus': '  ' } });
        const lines = buildThemeSection({ descriptions: { ...DEFAULT_TOKEN_DESCRIPTIONS, 'color.focus': 'one\ntwo' } });

        expect(blank.errors.map((error) => error.code)).toEqual(['SUI-BUILD-TOKENDESC']);
        expect(lines.errors.map((error) => error.code)).toEqual(['SUI-BUILD-TOKENDESC']);
    });
});

describe('theme section of catalog.json from buildLibrary', () => {
    const SOURCE = { 'atoms/one/one.view.html': '<p></p>', 'atoms/one/one.state.json': '{ "summary": "A test component" }' };

    it('should write the same theme section that the result holds', async () => {
        const source = await library(SOURCE);
        const out = await library({});

        const result = await buildLibrary(source, out);

        const written = JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8')) as { theme: unknown };
        expect(result.errors).toEqual([]);
        expect(written.theme).toEqual(JSON.parse(JSON.stringify(result.catalog.theme)));
        expect(result.catalog.theme.tokens.length).toBeGreaterThan(0);
    });

    it('should fail the build for a token without a description', async () => {
        const source = await library(SOURCE);
        const out = await library({});

        const result = await buildLibrary(source, out, { tokenDescriptions: {} });

        expect(result.errors.length).toBeGreaterThan(0);
        expect(new Set(result.errors.map((error) => error.code))).toEqual(new Set(['SUI-BUILD-TOKENDESC']));
    });
});
