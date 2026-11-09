import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { Plugin } from 'esbuild';

/** What the API reads to serve the bundle: the content hash and the name of the script file */
export interface RuntimeBundleManifest {
    hash: string;
    script: string;
    /** The names of the catalog components the bundle was built with, so a server can tell when it is out of date */
    components: string[];
}

export interface RuntimeBundleOptions {
    /** The bundle entry file */
    entry: string;
    /** The folder the script and `manifest.json` are written to; files of earlier builds are removed from it */
    outDir: string;
}

export const MANIFEST_FILE = 'manifest.json';
const HASH_LENGTH = 16;

const OVERLAYS_MODULE = 'virtual:component-overlays';
const OVERLAY_FILE = /^(.+).locale.([a-z]+(?:-[a-z0-9]+)*).json$/;

/**
 * The module `virtual:component-overlays`: every `<name>.locale.<code>.json` the component library ships, as the
 * `ComponentOverlays` map (component name, then language code) that `startRuntime` takes, so component text
 * translates in the preview. The files are found by listing the library's `dist/components` folder
 */
function componentOverlaysPlugin(): Plugin {
    return {
        name: 'component-overlays',
        setup(esbuild) {
            esbuild.onResolve({ filter: /^virtual:component-overlays$/ }, () => ({ path: OVERLAYS_MODULE, namespace: 'overlays' }));
            esbuild.onLoad({ filter: /.*/, namespace: 'overlays' }, () => {
                const require = createRequire(import.meta.url);
                const folder = dirname(require.resolve('@punyts/stateui-components/catalog.json'));
                const imports: string[] = [];
                const entries: string[] = [];
                for (const file of readdirSync(folder).sort()) {
                    const match = OVERLAY_FILE.exec(file);
                    if (!match) continue;
                    const [, component, code] = match;
                    imports.push(`import overlay${imports.length} from './${file}' with { type: 'json' };`);
                    entries.push(`[${JSON.stringify(component)}, ${JSON.stringify(code)}, overlay${entries.length}]`);
                }
                const contents = [
                    ...imports,
                    `const overlays = {};`,
                    `for (const [component, code, overlay] of [${entries.join(', ')}]) (overlays[component] ??= {})[code] = overlay;`,
                    'export default overlays;',
                    ''
                ].join('\n');
                return { contents, loader: 'js', resolveDir: folder };
            });
        }
    };
}

/** The names of the components in the library's `catalog.json`, the one the bundle imports */
function catalogComponents(): string[] {
    const require = createRequire(import.meta.url);
    const catalog = require('@punyts/stateui-components/catalog.json') as { components: { name: string }[] };
    return catalog.components.map((component) => component.name).sort();
}

/**
 * Bundles `entry` (StateUI, the component system and the component library with their dependencies) into one
 * classic script. The file is named after a hash of its content, so a changed source gives a new name and the API
 * can serve it as immutable. A classic script, not a module: a frame sandboxed without `allow-same-origin` has an
 * opaque origin, and a module script would need a CORS response
 */
export async function buildRuntimeBundle(options: RuntimeBundleOptions): Promise<RuntimeBundleManifest> {
    const result = await build({
        entryPoints: [options.entry],
        bundle: true,
        plugins: [componentOverlaysPlugin()],
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'es2022',
        minify: true,
        legalComments: 'none',
        define: { 'process.env.NODE_ENV': '"production"' },
        logLevel: 'silent'
    });
    const [output] = result.outputFiles;
    if (result.outputFiles.length !== 1 || !output) {
        throw new Error(`The runtime bundle must be one file, esbuild produced ${result.outputFiles.length}`);
    }

    const hash = createHash('sha256').update(output.contents).digest('hex').slice(0, HASH_LENGTH);
    const manifest: RuntimeBundleManifest = { hash, script: `${hash}.js`, components: catalogComponents() };

    await mkdir(options.outDir, { recursive: true });
    for (const name of await readdir(options.outDir)) {
        if (name === MANIFEST_FILE || name.endsWith('.js')) await rm(join(options.outDir, name), { force: true });
    }
    await writeFile(join(options.outDir, manifest.script), output.contents);
    await writeFile(join(options.outDir, MANIFEST_FILE), `${JSON.stringify(manifest)}\n`);
    return manifest;
}

const here = dirname(fileURLToPath(import.meta.url));

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const manifest = await buildRuntimeBundle({
        entry: join(here, 'entry.ts'),
        outDir: join(here, '..', 'dist', 'runtime-bundle')
    });
    process.stdout.write(`Built runtime bundle ${manifest.script}\n`);
}
