import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { scanLibrary } from '../core/convention/index.js';
import type { FileMap, ScannedComponent } from '../core/convention/index.js';
import { buildError } from '../core/errors/index.js';
import type { BuildError } from '../core/errors/index.js';
import { buildDefaults, parseShape } from '../core/shape/index.js';
import type { Shape } from '../core/shape/index.js';
import type { JsonObject, Node } from '../core/types.js';
import { composedEntry, emitCatalog, rootEntry, sizeError, sizeOf } from './catalog.js';
import type { CatalogSize, ComponentCatalogEntry } from './catalog.js';
import { compileCheck } from './check.js';
import { compileController } from './controller.js';
import { loadStateUI } from './dom.js';
import type { StateUIModule } from './dom.js';
import { emitIndex, emitIndexTypes, emitModule, emitModuleTypes } from './emit.js';
import { buildFailure } from './failures.js';
import type { BuildOptions, BuildResult, BuiltComponent } from './types.js';

async function listFiles(root: string, relative = ''): Promise<string[]> {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    const paths: string[] = [];
    for (const entry of entries) {
        const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) paths.push(...(await listFiles(root, path)));
        else if (entry.isFile()) paths.push(path);
    }
    return paths.sort();
}

interface Compiled {
    files: Map<string, string>;
    errors: BuildError[];
    shape?: Shape;
}

async function compileComponent(
    stateui: StateUIModule,
    sourceDir: string,
    component: ScannedComponent,
    options: BuildOptions
): Promise<Compiled> {
    const errors: BuildError[] = [];
    const files = new Map<string, string>();
    const viewFile = component.files.view as string;
    const stateFile = component.files.state as string;

    // Source text with LF newlines, so the output does not depend on the platform of the checkout
    const read = async (file: string): Promise<string | undefined> => {
        try {
            return (await readFile(join(sourceDir, file), 'utf8')).replace(/\r\n?/g, '\n');
        } catch {
            errors.push(buildFailure('file', file, 'could not be read'));
            return undefined;
        }
    };

    const stateText = await read(stateFile);
    const view = await read(viewFile);
    const cssFile = component.files.css;
    const cssSource = cssFile === undefined ? undefined : await read(cssFile);

    let defaultState: JsonObject = {};
    let shape: Shape | undefined;
    if (stateText !== undefined) {
        const result = parseShape(stateText, stateFile);
        errors.push(...result.errors);
        if (result.shape) {
            shape = result.shape;
            defaultState = buildDefaults(result.shape);
        }
    }
    if (sizeOf(component.group) === undefined) errors.push(sizeError(component.name, viewFile));

    let css = cssSource;
    if (cssFile !== undefined && cssSource !== undefined) {
        const context = { component: component.name, file: cssFile };
        for (const check of options.cssChecks ?? []) errors.push(...check(cssSource, context));
        for (const transform of options.cssTransforms ?? []) css = transform(css as string, context);
    }

    if (view !== undefined && (cssFile === undefined || css !== undefined)) {
        const styles = cssFile === undefined ? undefined : { file: cssFile, text: css as string };
        errors.push(...compileCheck(stateui, { file: viewFile, text: view }, styles));
    }

    let hasController = false;
    const controllerFile = component.files.controller;
    if (controllerFile !== undefined) {
        const text = await read(controllerFile);
        if (text !== undefined) {
            const compiled = compileController(text, controllerFile);
            errors.push(...compiled.errors);
            if (compiled.js !== undefined) {
                files.set(`${component.name}.controller.js`, compiled.js);
                hasController = true;
            }
        }
    }

    if (errors.length > 0 || view === undefined) return { files: new Map(), errors };

    files.set(
        `${component.name}.js`,
        emitModule({
            name: component.name,
            tag: component.tag,
            template: view,
            ...(css === undefined ? {} : { styles: css }),
            defaultState,
            controller: hasController
        })
    );
    files.set(`${component.name}.d.ts`, emitModuleTypes());
    return { files, errors, ...(shape === undefined ? {} : { shape }) };
}

/** Reads a composed file: one JSON object with a `component` name; anything else is a shape error on the file */
async function readComposed(sourceDir: string, file: string, errors: BuildError[]): Promise<Node | undefined> {
    let text: string;
    try {
        text = await readFile(join(sourceDir, file), 'utf8');
    } catch {
        errors.push(buildFailure('file', file, 'could not be read'));
        return undefined;
    }
    let tree: unknown;
    try {
        tree = JSON.parse(text);
    } catch {
        errors.push(buildError('SUI-BUILD-SHAPE', { file, name: 'json' }));
        return undefined;
    }
    const valid = typeof tree === 'object' && tree !== null && !Array.isArray(tree) && typeof (tree as Node).component === 'string';
    if (!valid) {
        errors.push(buildError('SUI-BUILD-SHAPE', { file, name: '$' }));
        return undefined;
    }
    return tree as Node;
}

/**
 * Builds a component library folder: scans it by convention, compiles each root component's template and
 * stylesheet with StateUI, and writes one module per root component (plus its compiled controller) and an
 * index to `outDir`. A component with an error gets no module and the others are still built, so one run
 * reports every problem. Composed components have no module. Also writes `catalog.json`, which describes every
 * component that built, root and composed, sorted by name. Output depends on the sources only, so two
 * builds of the same input are byte-identical. Files in `outDir` from earlier builds are not removed
 */
export async function buildLibrary(sourceDir: string, outDir: string, options: BuildOptions = {}): Promise<BuildResult> {
    const stateui = await loadStateUI();
    const fileMap: Record<string, true> = {};
    for (const path of await listFiles(sourceDir)) fileMap[path] = true;
    const scan = scanLibrary(fileMap as FileMap);
    const errors: BuildError[] = [...scan.errors];

    const output = new Map<string, string>();
    const built: BuiltComponent[] = [];
    const entries: ComponentCatalogEntry[] = [];
    for (const component of scan.components) {
        if (component.tier === 'composed') {
            const file = component.files.composed as string;
            const size = sizeOf(component.group);
            if (size === undefined) {
                errors.push(sizeError(component.name, file));
                continue;
            }
            const tree = await readComposed(sourceDir, file, errors);
            if (tree !== undefined) entries.push(composedEntry(component, tree, size));
            continue;
        }
        const compiled = await compileComponent(stateui, sourceDir, component, options);
        errors.push(...compiled.errors);
        if (compiled.errors.length > 0) continue;
        for (const [file, text] of compiled.files) output.set(file, text);
        built.push({ component, files: [...compiled.files.keys()].sort() });
        if (compiled.shape) entries.push(rootEntry(component, compiled.shape, sizeOf(component.group) as CatalogSize));
    }

    output.set('index.js', emitIndex(built.map((entry) => entry.component.name)));
    output.set('index.d.ts', emitIndexTypes());
    const { catalog, text } = emitCatalog(entries);
    output.set('catalog.json', text);

    const files = [...output.keys()].sort();
    for (const file of files) {
        const target = join(outDir, file);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, output.get(file) as string, 'utf8');
    }

    return { built, errors, files, catalog };
}
