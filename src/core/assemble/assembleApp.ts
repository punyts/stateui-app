import type { AppBlueprint, PartKind, PartRef } from '../blueprint/types.js';
import { EXPOSES_KEY } from '../convention/index.js';
import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { cloneJson } from '../resolve/index.js';
import { isObject } from '../resolve/merge.js';
import type { AppDocument, DocumentScreen, JsonObject, JsonValue, Node } from '../types.js';
import { nearestNames } from './nearest.js';
import type { AssembleOptions, AssembleResult, PartSource } from './types.js';

/** How a missing part is named in its error */
const KIND_WORDS: Readonly<Record<PartKind, string>> = {
    apps: 'app',
    themes: 'theme',
    logic: 'logic module',
    models: 'model',
    data: 'dataset',
    components: 'component',
    patterns: 'pattern'
};

class Assembler {
    readonly errors: BuildError[] = [];
    readonly uses: PartRef[] = [];
    readonly composed: Record<string, Node> = {};
    private readonly seen = new Set<string>();
    /** Component names already looked up, so a missing one is reported once, at its first use */
    private readonly looked = new Set<string>();

    constructor(
        private readonly parts: PartSource,
        private readonly options: AssembleOptions
    ) {}

    use(kind: PartKind, name: string): void {
        const key = `${kind}/${name}`;
        if (this.seen.has(key)) return;
        this.seen.add(key);
        this.uses.push({ kind, name });
    }

    /** Records the use when the part exists, an error with the nearest names when it does not; true when it exists */
    require(kind: PartKind, name: string, path: string, available: Readonly<Record<string, unknown>> | undefined): boolean {
        if (available !== undefined && Object.hasOwn(available, name)) {
            this.use(kind, name);
            return true;
        }
        this.missing(kind, name, path, Object.keys(available ?? {}));
        return false;
    }

    missing(kind: PartKind, name: string, path: string, candidates: Iterable<string>): void {
        const near = nearestNames(name, candidates);
        const other = near.length > 0 ? near.join(', ') : '(none)';
        const error = buildError('SUI-USES-MISSING', { target: KIND_WORDS[kind], name, path, other, statePath: path });
        if (kind === 'components') error.component = name;
        this.errors.push(error);
    }

    /** Finds every node under `value` and brings in the owner components they name, with their own trees */
    components(value: JsonValue, path: string): void {
        if (Array.isArray(value)) {
            value.forEach((item, index) => this.components(item, `${path}.${index}`));
            return;
        }
        if (!isObject(value)) return;
        const name = value['component'];
        if (typeof name === 'string') this.component(name, path);
        for (const [key, child] of Object.entries(value)) {
            if (key !== 'component') this.components(child, `${path}.${key}`);
        }
    }

    component(name: string, path: string): void {
        if (this.looked.has(name)) return;
        this.looked.add(name);
        const owned = this.parts.components;
        const part = owned !== undefined && Object.hasOwn(owned, name) ? owned[name] : undefined;
        if (part !== undefined) {
            this.use('components', name);
            const tree = cloneJson(part.tree as unknown as JsonValue) as JsonObject;
            if (part.exposes.length > 0) tree[EXPOSES_KEY] = Object.fromEntries(part.exposes.map((entry) => [entry.path, entry.description]));
            this.composed[name] = tree as Node;
            this.components(part.tree as unknown as JsonValue, `$.composed.${name}`);
            return;
        }
        const library = this.options.library;
        if (library !== undefined && !Object.hasOwn(library, name)) {
            this.missing('components', name, path, [...Object.keys(owned ?? {}), ...Object.keys(library)]);
        }
    }
}

/**
 * Builds the document the runtime mounts from a blueprint and the owner's parts. The first theme of `uses.themes`
 * gives `theme.tokens` and `themes` (its overlays); every listed theme must exist. Each `uses.data` binding becomes
 * `data.{binding}`: the dataset's records, or an empty map for a persona binding. Owner components named by a node of
 * the shell, a screen or another used owner component go into `composed` as their trees with `exposes`, without the
 * search keys; an owner component wins over a library component of the same name, as `composed` does. `logic` is the
 * app's own units and `app` is the shell. Modules and models named in `uses` must exist; binding them is a later step.
 *
 * Pure: the blueprint and the parts are never changed and the document shares nothing with them
 */
export function assembleApp(blueprint: AppBlueprint, parts: PartSource, options: AssembleOptions = {}): AssembleResult {
    const assembler = new Assembler(parts, options);
    const document: AppDocument = { app: cloneJson(blueprint.shell as unknown as JsonValue) as Node };

    const themes = blueprint.uses?.themes ?? [];
    themes.forEach((name, index) => assembler.require('themes', name, `$.uses.themes.${index}`, parts.themes));
    const first = themes[0] === undefined ? undefined : parts.themes?.[themes[0]];
    if (first !== undefined && Object.hasOwn(parts.themes ?? {}, themes[0] as string)) {
        document.theme = { tokens: cloneJson(first.tokens) as JsonObject };
        if (first.overlays !== undefined) document.themes = cloneJson(first.overlays as unknown as JsonValue) as unknown as AppDocument['themes'];
    }

    const data: JsonObject = {};
    for (const [binding, target] of Object.entries(blueprint.uses?.data ?? {})) {
        const at = `$.uses.data.${binding}`;
        if ('dataset' in target) {
            if (assembler.require('data', target.dataset, `${at}.dataset`, parts.datasets)) {
                data[binding] = cloneJson((parts.datasets?.[target.dataset]?.records ?? {}) as JsonObject);
            }
        } else {
            assembler.require('models', target.model, `${at}.model`, parts.models);
            data[binding] = {};
        }
    }
    if (Object.keys(data).length > 0) document.data = data;

    for (const name of Object.keys(blueprint.uses?.logic ?? {})) assembler.require('logic', name, `$.uses.logic.${name}`, parts.modules);

    assembler.components(blueprint.shell as unknown as JsonValue, '$.shell');
    const screens: Record<string, DocumentScreen> = {};
    for (const [name, screen] of Object.entries(blueprint.screens)) {
        screens[name] = cloneJson(screen as unknown as JsonValue) as unknown as DocumentScreen;
        assembler.components(screen.root as unknown as JsonValue, `$.screens.${name}.root`);
    }
    document.screens = screens;
    document.start = blueprint.start;
    if (Object.keys(assembler.composed).length > 0) document.composed = assembler.composed;
    if (blueprint.logic !== undefined) document.logic = cloneJson(blueprint.logic as unknown as JsonValue) as JsonObject;
    if (blueprint.locales !== undefined) document.locales = cloneJson(blueprint.locales as unknown as JsonValue) as AppDocument['locales'];

    return { document, errors: assembler.errors, uses: assembler.uses };
}
