// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MANIFEST_FILE, buildRuntimeBundle } from './build.ts';

describe('buildRuntimeBundle', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'runtime-bundle-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    async function bundleOf(source: string, outName: string) {
        const entry = join(dir, 'entry.ts');
        await writeFile(entry, source);
        return buildRuntimeBundle({ entry, outDir: join(dir, outName) });
    }

    it('should change the file name when the source changes', async () => {
        // Act
        const first = await bundleOf('window.name = "one";', 'out');
        const second = await bundleOf('window.name = "two";', 'out');

        // Assert
        expect(second.script).not.toBe(first.script);
        expect(second.hash).not.toBe(first.hash);
    });

    it('should keep the file name when the source does not change', async () => {
        // Act
        const first = await bundleOf('window.name = "same";', 'one');
        const second = await bundleOf('window.name = "same";', 'two');

        // Assert
        expect(second.script).toBe(first.script);
    });

    it('should write the script and the manifest and remove the script of the earlier build', async () => {
        // Arrange
        const first = await bundleOf('window.name = "one";', 'out');

        // Act
        const second = await bundleOf('window.name = "two";', 'out');

        // Assert
        const files = (await readdir(join(dir, 'out'))).sort();
        expect(files).toEqual([MANIFEST_FILE, second.script].sort());
        expect(files).not.toContain(first.script);
        const manifest: unknown = JSON.parse(await readFile(join(dir, 'out', MANIFEST_FILE), 'utf8'));
        expect(manifest).toEqual(second);
    });

    it('should name the script after a hash of its content', async () => {
        // Act
        const manifest = await bundleOf('window.name = "one";', 'out');

        // Assert
        expect(manifest.script).toMatch(/^[0-9a-f]{16}\.js$/);
        expect(manifest.script).toBe(`${manifest.hash}.js`);
    });
});
