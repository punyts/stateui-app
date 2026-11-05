import type { AppBlueprint, DataBinding, PartKind, PartRef } from '../blueprint/types.js';
import { EXPOSES_KEY } from '../convention/index.js';
import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { cloneJson } from '../resolve/index.js';
import { isObject } from '../resolve/merge.js';
import { instantiateModule } from '../logic/modules.js';
import type { LogicDocument } from '../logic/types.js';
import { applyDefaults } from '../models/model.js';
import type { AppDocument, DocumentScreen, JsonObject, JsonValue, Node } from '../types.js';
import { nearestNames } from './nearest.js';
import type { AssembleError, AssembleOptions, AssembleResult, PartSource } from './types.js';

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

/** The unit kinds of a logic document, in the order the assembled `logic` lists them */
const UNIT_KINDS = ['machines', 'rules', 'tables'] as const;

class Assembler {
    readonly errors: AssembleError[] = [];
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

/** How a binding's records are described in a `SUI-USES-MODEL` error */
function modelWords(model: string | null): string {
    return model === null ? 'holds records of no model' : `holds records of the model "${model}"`;
}

/**
 * The app's own units followed by the units of each logic module it uses. Each module's needs must be bound under
 * their own names to data of the model they name, two modules that need one name must name one model, and the params
 * of `uses.logic` must fit their declarations. A module with errors adds no units
 */
function bindModules(blueprint: AppBlueprint, parts: PartSource, assembler: Assembler, bound: ReadonlyMap<string, string | null>): LogicDocument {
    const logic = (blueprint.logic === undefined ? {} : cloneJson(blueprint.logic as unknown as JsonValue)) as Record<string, Record<string, JsonValue>>;
    const bindings: Readonly<Record<string, DataBinding>> = blueprint.uses?.data ?? {};
    /** The first module that needs each name, with the model it names */
    const needed = new Map<string, { module: string; model: string }>();

    for (const [name, use] of Object.entries(blueprint.uses?.logic ?? {})) {
        const at = `$.uses.logic.${name}`;
        if (!assembler.require('logic', name, at, parts.modules)) continue;
        const module = parts.modules?.[name];
        if (module === undefined) continue;
        const part: PartRef = { kind: 'logic', name };
        const before = assembler.errors.length;

        for (const [need, { model }] of Object.entries(module.needs)) {
            if (Object.hasOwn(parts.models ?? {}, model)) assembler.use('models', model);
            const path = `$.uses.data.${need}`;
            const first = needed.get(need);
            if (first !== undefined) {
                if (first.model !== model) {
                    const reason = `is needed by the logic modules "${first.module}" (model "${first.model}") and "${name}" (model "${model}"), which must name one model`;
                    assembler.errors.push({ ...buildError('SUI-USES-MODEL', { name: need, path, reason, statePath: path }), part });
                }
                continue;
            }
            needed.set(need, { module: name, model });
            if (!Object.hasOwn(bindings, need)) {
                assembler.errors.push({ ...buildError('SUI-USES-NEEDS', { target: name, name: need, path, statePath: path }), part });
                continue;
            }
            const actual = bound.get(need);
            if (actual === undefined || actual === model) continue;
            const reason = `${modelWords(actual)}, and the logic module "${name}" needs the model "${model}"`;
            assembler.errors.push({ ...buildError('SUI-USES-MODEL', { name: need, path, reason, statePath: path }), part });
        }

        const instance = instantiateModule(module, use.params ?? {}, { name, paramsPath: `${at}.params` });
        for (const error of instance.errors) assembler.errors.push({ ...error, part });
        if (assembler.errors.length > before) continue;
        const units = instance.logic as unknown as Record<string, Record<string, JsonValue> | undefined>;
        for (const kind of UNIT_KINDS) {
            const own = units[kind];
            if (own === undefined) continue;
            logic[kind] = { ...(logic[kind] ?? {}), ...own };
        }
    }
    return logic as unknown as LogicDocument;
}

/**
 * Builds the document the runtime mounts from a blueprint and the owner's parts. The first theme of `uses.themes`
 * gives `theme.tokens` and `themes` (its overlays), and `appThemes` carries every listed theme by name (tokens and
 * overlays) for switching at run time; every listed theme must exist. Each `uses.data` binding becomes
 * `data.{binding}`: the dataset's records, or an empty map for a persona binding. Owner components named by a node of
 * the shell, a screen or another used owner component go into `composed` as their trees with `exposes`, without the
 * search keys; an owner component wins over a library component of the same name, as `composed` does. `app` is the
 * shell. A persona binding starts as the model's defaults over an empty map (`applyDefaults(model, {})`), so a model
 * without defaults gives `{}`. `logic` is the app's own units followed by each module of `uses.logic`, instantiated
 * with its params (`instantiateModule`, units named `{module}:{unit}`); a module whose needs are not bound under their
 * names to data of their models (`SUI-USES-NEEDS`, `SUI-USES-MODEL`) or whose params do not fit (`SUI-MODULE-PARAM`)
 * adds no units, and its errors carry the module as `part`.
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
    const listed: NonNullable<AppDocument['appThemes']> = {};
    for (const name of themes) {
        const part = Object.hasOwn(parts.themes ?? {}, name) ? parts.themes?.[name] : undefined;
        if (part !== undefined) listed[name] = cloneJson(part as unknown as JsonValue) as unknown as NonNullable<AppDocument['appThemes']>[string];
    }
    if (Object.keys(listed).length > 0) document.appThemes = listed;

    const data: JsonObject = {};
    /** The model of each binding whose target exists; null for a dataset without a model */
    const bound = new Map<string, string | null>();
    for (const [binding, target] of Object.entries(blueprint.uses?.data ?? {})) {
        const at = `$.uses.data.${binding}`;
        if ('dataset' in target) {
            if (assembler.require('data', target.dataset, `${at}.dataset`, parts.datasets)) {
                const dataset = parts.datasets?.[target.dataset];
                data[binding] = cloneJson((dataset?.records ?? {}) as JsonObject);
                bound.set(binding, dataset?.model ?? null);
                if (dataset?.model !== undefined && Object.hasOwn(parts.models ?? {}, dataset.model)) assembler.use('models', dataset.model);
            }
        } else if (assembler.require('models', target.model, `${at}.model`, parts.models)) {
            const model = parts.models?.[target.model];
            data[binding] = model === undefined ? {} : applyDefaults(model, {});
            bound.set(binding, target.model);
        } else data[binding] = {};
    }
    if (Object.keys(data).length > 0) document.data = data;

    const logic = bindModules(blueprint, parts, assembler, bound);

    assembler.components(blueprint.shell as unknown as JsonValue, '$.shell');
    const screens: Record<string, DocumentScreen> = {};
    for (const [name, screen] of Object.entries(blueprint.screens)) {
        screens[name] = cloneJson(screen as unknown as JsonValue) as unknown as DocumentScreen;
        assembler.components(screen.root as unknown as JsonValue, `$.screens.${name}.root`);
    }
    document.screens = screens;
    document.start = blueprint.start;
    if (Object.keys(assembler.composed).length > 0) document.composed = assembler.composed;
    if (Object.keys(logic).length > 0) document.logic = logic as unknown as JsonObject;
    if (blueprint.locales !== undefined) document.locales = cloneJson(blueprint.locales as unknown as JsonValue) as AppDocument['locales'];

    return { document, errors: assembler.errors, uses: assembler.uses };
}
