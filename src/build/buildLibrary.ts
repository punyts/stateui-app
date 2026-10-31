import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { scanLibrary } from '../core/convention/index.js';
import type { FileMap, ScannedComponent } from '../core/convention/index.js';
import { buildError } from '../core/errors/index.js';
import type { BuildError } from '../core/errors/index.js';
import { validateComponentOverlay, validateLocaleOverlay } from '../core/locale/index.js';
import { resolveNode } from '../core/resolve/index.js';
import type { ComponentLibrary } from '../core/resolve/index.js';
import { buildDefaults, collectComponentTokens, parseShape } from '../core/shape/index.js';
import type { Shape } from '../core/shape/index.js';
import type { ComponentToken } from '../core/theme/index.js';
import { generateSharedSheet } from '../dom/articulation/index.js';
import { checkTokens, lintCss } from './lint/index.js';
import { applyTokenFallbacks } from './tokenFallbacks.js';
import type { JsonObject, Node } from '../core/types.js';
import { composedEntry, emitCatalog, rootEntry, sizeError, sizeOf } from './catalog.js';
import type { CatalogSize, ComponentCatalogEntry } from './catalog.js';
import { compileCheck } from './check.js';
import { compileController } from './controller.js';
import { loadStateUI } from './dom.js';
import type { StateUIModule } from './dom.js';
import { emitIndex, emitIndexTypes, emitModule, emitModuleTypes } from './emit.js';
import { buildFailure } from './failures.js';
import { SHARED_SHEET_LINES, prependSharedSheet } from './sharedSheet.js';
import { LAYOUT_SHEET_LINES, checkLayoutHost, prependLayoutSheets } from './layoutSheets.js';
import { emitOverlay, inFile, overlayFileName, readOverlay } from './overlays.js';
import type { ReadOverlay } from './overlays.js';
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

/** The prepended shared sheet shifts the lines StateUI reports; this puts them back on the lines of the file */
function withoutSharedSheet(problem: BuildError, prependedLines: number): BuildError {
    if (problem.line === undefined) return problem;
    return { ...problem, line: Math.max(1, problem.line - prependedLines) };
}

/** The component tokens of the whole library, and the group conflicts by the state file that holds them */
interface LibraryTokens {
    tokens: readonly ComponentToken[];
    conflicts: ReadonlyMap<string, BuildError[]>;
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
    options: BuildOptions,
    library: LibraryTokens
): Promise<Compiled> {
    const errors: BuildError[] = [...(library.conflicts.get(component.files.state as string) ?? [])];
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

    for (const [code, file] of Object.entries(component.locales)) {
        const read = await readOverlay(sourceDir, code, file, errors);
        if (read === undefined || shape === undefined) continue;
        const problems = inFile(validateComponentOverlay(code, read.overlay, shape), file);
        errors.push(...problems);
        if (problems.length === 0) files.set(overlayFileName(component.name, code), emitOverlay(read.overlay));
    }

    // A component without a stylesheet still gets the shared one, under the file name the convention would give it
    const styleFile = cssFile ?? viewFile.replace(/\.html$/, '.css');
    let css: string | undefined = cssFile === undefined ? '' : cssSource;
    let prependedLines = SHARED_SHEET_LINES;
    if (css !== undefined) {
        const context = { component: component.name, file: styleFile, tokens: library.tokens };
        if (cssSource !== undefined) for (const check of [checkTokens, ...(options.cssChecks ?? [])]) errors.push(...check(cssSource, context));
        const supportsLayout = shape?.layout === true;
        const builtIn = supportsLayout ? [prependSharedSheet, prependLayoutSheets] : [prependSharedSheet];
        for (const transform of [...builtIn, applyTokenFallbacks, ...(options.cssTransforms ?? [])]) css = transform(css, context);
        prependedLines = SHARED_SHEET_LINES + (supportsLayout ? LAYOUT_SHEET_LINES : 0);
    }
    if (view !== undefined && shape !== undefined) errors.push(...checkLayoutHost(view, shape.layout, viewFile));

    if (view !== undefined && css !== undefined) {
        const problems = compileCheck(stateui, { file: viewFile, text: view }, { file: styleFile, text: css });
        errors.push(...problems.map((problem) => (problem.file === styleFile ? withoutSharedSheet(problem, prependedLines) : problem)));
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

/** A composed component read from disk, waiting for the whole library to check its overlays */
interface PendingComposed {
    component: ScannedComponent;
    tree: Node;
    size: CatalogSize;
    overlays: ReadOverlay[];
}

/** The components that built so far, as the resolver reads them */
function libraryOf(entries: readonly ComponentCatalogEntry[]): ComponentLibrary {
    const library: Record<string, ComponentLibrary[string]> = {};
    for (const entry of entries) {
        library[entry.name] = entry.tier === 'root' ? { tier: 'root', tag: entry.tag, shape: entry.shape } : { tier: 'composed', tree: entry.tree };
    }
    return library;
}

/** Checks each overlay of a composed component against the paths of its resolved default tree */
function checkComposedOverlays(item: PendingComposed, library: ComponentLibrary): BuildError[] {
    const { exposes: _exposes, ...own } = item.tree as JsonObject;
    const resolved = resolveNode(own as Node, library, {}, { path: '$' }).node as JsonObject;
    return item.overlays.flatMap((read) => inFile(validateLocaleOverlay(read.code, read.overlay, resolved, { library, path: '$' }), read.file));
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
 * Reads every root component's shape ahead of the build, so a component's CSS can be checked and rewritten against the
 * tokens of the whole library. Shape errors are left for the component's own build; a group conflict is reported once
 * per state file and fails that component
 */
async function collectLibraryTokens(sourceDir: string, components: readonly ScannedComponent[]): Promise<LibraryTokens> {
    const sources: { file: string; shape: Shape }[] = [];
    for (const component of components) {
        const file = component.files.state;
        if (component.tier !== 'root' || file === undefined) continue;
        try {
            const text = (await readFile(join(sourceDir, file), 'utf8')).replace(/\r\n?/g, '\n');
            const result = parseShape(text, file);
            if (result.shape) sources.push({ file, shape: result.shape });
        } catch {
            continue;
        }
    }
    const collected = collectComponentTokens(sources);
    const conflicts = new Map<string, BuildError[]>();
    for (const error of collected.errors) {
        const file = error.file as string;
        conflicts.set(file, [...(conflicts.get(file) ?? []), error]);
    }
    return { tokens: collected.tokens, conflicts };
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

    const library = await collectLibraryTokens(sourceDir, scan.components);
    errors.push(
        ...lintCss(generateSharedSheet(), { file: 'generated shared sheet', tokens: library.tokens })
    );

    const output = new Map<string, string>();
    const built: BuiltComponent[] = [];
    const entries: ComponentCatalogEntry[] = [];
    const pending: PendingComposed[] = [];
    for (const component of scan.components) {
        if (component.tier === 'composed') {
            const file = component.files.composed as string;
            const size = sizeOf(component.group);
            if (size === undefined) {
                errors.push(sizeError(component.name, file));
                continue;
            }
            const tree = await readComposed(sourceDir, file, errors);
            if (tree === undefined) continue;
            const overlays: ReadOverlay[] = [];
            for (const [code, localeFile] of Object.entries(component.locales)) {
                const read = await readOverlay(sourceDir, code, localeFile, errors);
                if (read !== undefined) overlays.push(read);
            }
            pending.push({ component, tree, size, overlays });
            continue;
        }
        const compiled = await compileComponent(stateui, sourceDir, component, options, library);
        errors.push(...compiled.errors);
        if (compiled.errors.length > 0) continue;
        for (const [file, text] of compiled.files) output.set(file, text);
        built.push({ component, files: [...compiled.files.keys()].sort() });
        if (compiled.shape) entries.push(rootEntry(component, compiled.shape, sizeOf(component.group) as CatalogSize));
    }

    const resolver = libraryOf(entries);
    for (const item of pending) {
        const problems = checkComposedOverlays(item, resolver);
        errors.push(...problems);
        if (problems.length > 0 || item.overlays.length !== Object.keys(item.component.locales).length) continue;
        entries.push(composedEntry(item.component, item.tree, item.size));
        for (const read of item.overlays) output.set(overlayFileName(item.component.name, read.code), emitOverlay(read.overlay));
    }

    output.set('index.js', emitIndex(
            built.map((entry) => entry.component.name),
            collectComponentTokens(
                entries.flatMap((entry) => (entry.tier === 'root' ? [{ file: entry.name, shape: entry.shape }] : []))
            ).tokens
        ));
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
