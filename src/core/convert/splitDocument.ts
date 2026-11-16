import { slugifyName } from '../blueprint/names.js';
import type { AppBlueprint, BlueprintScreen, ComposedPart, DataBinding, DatasetPart, ModelPart, ThemePart } from '../blueprint/types.js';
import type { LogicDocument } from '../logic/types.js';
import { parseComposed } from '../convention/composed.js';
import { inferModel, readModel } from '../models/index.js';
import { cloneJson, isObject } from '../resolve/merge.js';
import { APP_COMPONENT, screenPath } from '../route/app.js';
import { NAVIGATE_COMMAND } from '../route/route.js';
import { RESERVED_KEYS, isAppEvent } from '../types.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import type { SplitInput, SplitProblem, SplitRename, SplitResult } from './types.js';

const APP_PATH = '$.app';

/** The screen a document without a hidden-strip `tabs` becomes */
const MAIN_SCREEN = 'main';

const TABS_COMPONENT = 'tabs';

/** The placement keys of a tab, which belong to the strip and are dropped with it */
const PLACEMENT = 'placement';

/** A hidden-strip `tabs` node: its state path, the steps below `$.app` and the node */
interface FoundTabs {
    path: string;
    steps: string[];
    node: JsonObject;
}

/** The names of one conversion: taken ones per kind, and the renames */
class Names {
    private readonly used = new Map<string, Set<string>>();
    readonly renamed: SplitRename[] = [];

    constructor(taken: SplitInput['taken'] = {}) {
        for (const [kind, names] of Object.entries(taken)) this.used.set(kind, new Set(names));
    }

    /** A slug of `raw` free in `kind`, which is then taken; a rename is recorded when it differs from `from` */
    name(kind: SplitRename['kind'], raw: string, from = raw): string {
        const used = this.used.get(kind) ?? new Set<string>();
        this.used.set(kind, used);
        const slug = slugifyName(raw, used);
        used.add(slug);
        if (slug !== from) this.renamed.push({ kind, from, to: slug });
        return slug;
    }
}

function problem(path: string, reason: string): SplitProblem {
    return { path, reason };
}

/** `value` with every string replaced by `visit` of it and its path */
function mapStrings(value: JsonValue, path: string, visit: (text: string, path: string) => string): JsonValue {
    if (typeof value === 'string') return visit(value, path);
    if (Array.isArray(value)) return value.map((item, index) => mapStrings(item, `${path}.${index}`, visit));
    if (!isObject(value)) return value;
    const result: JsonObject = {};
    for (const [key, child] of Object.entries(value)) result[key] = mapStrings(child, `${path}.${key}`, visit);
    return result;
}

/** Every place `path` or a path below it is named in a text: a whole value or inside an expression */
function pathPattern(path: string): RegExp {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);
    return new RegExp(`${escaped}(?![A-Za-z0-9_-])`, 'g');
}

/** `text` with `from` replaced by `to` wherever it names `from` or a path below it */
function movePath(text: string, from: string, to: string): string {
    return text.replace(pathPattern(from), () => to);
}

/** Every hidden-strip `tabs` node of the app tree, depth first in key order, not looking inside `on` entries */
function findHiddenTabs(value: JsonValue, steps: string[], found: FoundTabs[]): FoundTabs[] {
    if (Array.isArray(value)) {
        value.forEach((item, index) => findHiddenTabs(item, [...steps, String(index)], found));
        return found;
    }
    if (!isObject(value)) return found;
    if (value[RESERVED_KEYS.component] === TABS_COMPONENT && value['strip'] === 'hidden') {
        found.push({ path: [APP_PATH, ...steps].join('.'), steps, node: value });
    }
    for (const [key, child] of Object.entries(value)) {
        if (key !== RESERVED_KEYS.on) findHiddenTabs(child, [...steps, key], found);
    }
    return found;
}

/** Renames every `component` value found in `renames`, in place, `on` entries included */
function renameComponents(value: JsonValue, renames: ReadonlyMap<string, string>): void {
    if (Array.isArray(value)) {
        for (const item of value) renameComponents(item, renames);
        return;
    }
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
        if (key === RESERVED_KEYS.component && typeof child === 'string') {
            const renamed = renames.get(child);
            if (renamed !== undefined) value[key] = renamed;
        } else {
            renameComponents(child, renames);
        }
    }
}

/** A `set` of the strip's `active` to a tab name, as a `navigate` to that tab's screen; any other command unchanged */
function toNavigate(command: JsonValue, active: string, screens: ReadonlyMap<string, string>): JsonValue {
    if (!isObject(command) || command['command'] !== 'set' || command['target'] !== active || command['from'] !== undefined) return command;
    const screen = typeof command['value'] === 'string' ? screens.get(command['value']) : undefined;
    return screen === undefined ? command : { command: NAVIGATE_COMMAND, target: screen };
}

/** Turns, in place, every `on` command that sets the strip's `active` to a tab name into a `navigate` */
function rewriteNavigation(value: JsonValue, active: string, screens: ReadonlyMap<string, string>): void {
    if (Array.isArray(value)) {
        for (const item of value) rewriteNavigation(item, active, screens);
        return;
    }
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
        if (key === RESERVED_KEYS.on && isObject(child)) {
            for (const [event, entry] of Object.entries(child)) {
                child[event] = Array.isArray(entry) ? entry.map((command) => toNavigate(command, active, screens)) : toNavigate(entry, active, screens);
            }
        } else {
            rewriteNavigation(child, active, screens);
        }
    }
}

/** The value at `steps` below `root`; undefined when a step is missing */
function at(root: JsonValue | undefined, steps: readonly string[]): JsonValue | undefined {
    let current = root;
    for (const step of steps) {
        if (Array.isArray(current)) current = current[Number(step)];
        else if (isObject(current)) current = current[step];
        else return undefined;
    }
    return current;
}

/** A tab's node as a screen root: the node without the strip's placement */
function screenRoot(tab: JsonObject): Node {
    const { [PLACEMENT]: _placement, ...root } = cloneJson(tab);
    return root as unknown as Node;
}

/** The records a data value holds, keyed: an object of records as it is, a list keyed by each record's `id` */
function toRecords(value: JsonValue, path: string, problems: SplitProblem[]): Record<string, JsonObject> | undefined {
    if (Array.isArray(value)) {
        if (!value.every(isObject)) {
            problems.push(problem(path, 'holds a list whose items are not all records, so it cannot become a dataset'));
            return undefined;
        }
        const keys = new Set<string>();
        const records: Record<string, JsonObject> = {};
        value.forEach((record, index) => {
            const id = (record as JsonObject)['id'];
            const raw = typeof id === 'string' || typeof id === 'number' ? String(id) : `r${index + 1}`;
            const key = /^\d+$/.test(raw) || raw === '' || keys.has(raw) ? slugifyName(raw === '' ? `r${index + 1}` : raw, keys) : raw;
            keys.add(key);
            records[key] = cloneJson(record as JsonObject);
        });
        return records;
    }
    if (isObject(value) && Object.values(value).every(isObject)) {
        const integerLike = Object.keys(value).filter((key) => /^\d+$/.test(key));
        if (integerLike.length > 0) {
            problems.push(problem(path, `has integer-like record keys (${integerLike.join(', ')}), whose order is lost`));
            return undefined;
        }
        return cloneJson(value) as Record<string, JsonObject>;
    }
    const kind = isObject(value) ? 'an object whose values are not all records' : `a ${value === null ? 'null' : typeof value}, not records`;
    problems.push(problem(path, `holds ${kind}, so it cannot become a dataset`));
    return undefined;
}

/** The empty result: the report and no parts */
function unconverted(report: SplitProblem[], renamed: SplitRename[] = []): SplitResult {
    return { themes: {}, models: {}, datasets: {}, components: {}, renamed, report };
}

/**
 * Converts one stored app of the old single-document form into owner parts, as "Moving existing apps" of the owner-tree
 * design describes. Pure: the adapters read and write their own storage around it.
 *
 * - Names become slugs (`slugifyName`): the app, the theme, the datasets and models, the components and the screens;
 *   a name in `taken` or already given gets a numeric suffix. The stored name stays as the app's `title`.
 * - `app` becomes an `app` node and its screens. When the root is one hidden-strip `tabs` node, each tab becomes a
 *   screen (titled by its `_tab`), starting on the strip's `active` tab; an `on` command that sets the strip's
 *   `active` to a tab becomes a `navigate` to it. Otherwise the app node holds the root's app-event entries and the
 *   whole tree is the screen `main` (a hidden-strip `tabs` deeper in it stays tabs). State paths into moved
 *   nodes, in nodes and logic, follow them to `$.screens.{screen}`; the document's locale overlays are split the same way.
 * - `theme` and `themes` become a theme named after the app; `theme.active` is a choice, not a definition, and is dropped.
 * - Each key of `data` (the snapshot's `data` when it has one) becomes a dataset `{app}-{key}`, bound back under the key,
 *   and a model of the same name inferred from its records (`inferModel`). A list is keyed by each record's `id`.
 * - `composed` becomes owner components; nodes naming them follow their new names.
 *
 * An app that does not convert cleanly gets no parts, and `report` says why: a root strip that
 * logic, a link or its own `on` refers to, data that holds no records, a document that already has screens
 */
export function splitDocument(input: SplitInput): SplitResult {
    const { document, snapshot } = input;
    const names = new Names(input.taken);
    const report: SplitProblem[] = [];
    if (document.screens !== undefined) return unconverted([problem('$.screens', 'the document already has screens')]);

    const appName = names.name('apps', input.name);
    const app = cloneJson(document.app as unknown as JsonObject);
    let logic = document.logic === undefined ? undefined : cloneJson(document.logic);

    // Components first, so the trees name them by their new names
    const components: Record<string, ComposedPart> = {};
    const componentNames = new Map<string, string>();
    for (const name of Object.keys(document.composed ?? {})) componentNames.set(name, names.name('components', name));
    for (const [name, node] of Object.entries(document.composed ?? {})) {
        const parsed = parseComposed(cloneJson(node as unknown as JsonObject), `$.composed.${name}`);
        for (const error of parsed.errors) report.push(problem(`$.composed.${name}`, error.message));
        if (parsed.tree === undefined) continue;
        renameComponents(parsed.tree as unknown as JsonObject, componentNames);
        components[componentNames.get(name) as string] = {
            tree: parsed.tree,
            exposes: parsed.exposes,
            ...(parsed.summary === undefined ? {} : { summary: parsed.summary }),
            ...(parsed.category === undefined ? {} : { category: parsed.category }),
            ...(parsed.purposes === undefined ? {} : { purposes: parsed.purposes })
        };
    }
    renameComponents(app, componentNames);

    // The app node and the screens
    const tabs = findHiddenTabs(app, [], []);
    let appNode: JsonObject;
    const screens: Record<string, BlueprintScreen> = {};
    let start: string;
    /** Old path prefix to the screen's path */
    const moves: [string, string][] = [];
    // Only a strip at the root becomes the screens: the screens are laid out by the app node, not inside a frame
    const found = tabs[0] !== undefined && tabs[0].steps.length === 0 ? tabs[0] : undefined;
    if (found !== undefined) {
        const tabNames = new Map<string, string>();
        const children = found.node[RESERVED_KEYS.children];
        const tabEntries = isObject(children) ? Object.entries(children).filter((entry): entry is [string, JsonObject] => isObject(entry[1])) : [];
        if (tabEntries.length === 0) report.push(problem(found.path, 'the hidden-strip tabs has no tabs to become screens'));
        for (const [key] of tabEntries) tabNames.set(key, names.name('screens', key));
        if (found.node[RESERVED_KEYS.on] !== undefined) {
            report.push(problem(`${found.path}.on`, 'the strip has its own on entries, which no screen change raises'));
        }
        for (const key of Object.keys(found.node).filter((name) => name.startsWith('<-'))) {
            report.push(problem(`${found.path}.${key}`, `the strip's ${key.slice(2)} is linked to ${String(found.node[key])}, which screens cannot follow`));
        }
        rewriteNavigation(app, `${found.path}.active`, tabNames);
        const strip = (text: string, path: string): string => {
            let rest = text;
            for (const key of tabNames.keys()) rest = movePath(rest, `${found.path}.children.${key}`, '');
            if (pathPattern(found.path).test(rest)) {
                report.push(problem(path, `refers to the hidden-strip tabs at ${found.path} (${text}), which screens cannot follow`));
            }
            return text;
        };
        mapStrings(app, APP_PATH, strip);
        if (logic !== undefined) mapStrings(logic, '$.logic', strip);
        if (report.length > 0) return unconverted(report, names.renamed);

        const active = found.node['active'];
        start = (typeof active === 'string' ? tabNames.get(active) : undefined) ?? (tabNames.values().next().value as string);
        for (const [key, tab] of tabEntries) {
            const screen = tabNames.get(key) as string;
            const placement = tab[PLACEMENT];
            const title = isObject(placement) && typeof placement['_tab'] === 'string' && placement['_tab'] !== '' ? placement['_tab'] : key;
            screens[screen] = { title, root: screenRoot(tab) };
            moves.push([`${found.path}.children.${key}`, screenPath(screen)]);
        }
        appNode = { component: APP_COMPONENT };
        // Each tab's part of a locale overlay goes to its screen; the strip's own text has no place left
        if (document.locales !== undefined) {
            for (const [code, overlay] of Object.entries(document.locales)) {
                for (const [key] of tabEntries) {
                    const content = at(overlay, [RESERVED_KEYS.children, key]);
                    if (!isObject(content)) continue;
                    const { [PLACEMENT]: _placement, ...rest } = content;
                    if (Object.keys(rest).length === 0) continue;
                    const screen = screens[tabNames.get(key) as string] as BlueprintScreen;
                    screen.locales = { ...screen.locales, [code]: cloneJson(rest) };
                }
            }
        }
    } else {
        if (report.length > 0) return unconverted(report, names.renamed);
        start = names.name('screens', MAIN_SCREEN);
        appNode = { component: APP_COMPONENT };
        const on = app[RESERVED_KEYS.on];
        if (isObject(on)) {
            const appEvents = Object.entries(on).filter(([event]) => isAppEvent(event));
            if (appEvents.length > 0) {
                appNode[RESERVED_KEYS.on] = Object.fromEntries(appEvents);
                const rest = Object.fromEntries(Object.entries(on).filter(([event]) => !isAppEvent(event)));
                if (Object.keys(rest).length > 0) app[RESERVED_KEYS.on] = rest;
                else delete app[RESERVED_KEYS.on];
            }
        }
        screens[start] = { title: input.name, root: app as unknown as Node };
        moves.push([APP_PATH, screenPath(start)]);
        if (document.locales !== undefined && Object.keys(document.locales).length > 0) {
            (screens[start] as BlueprintScreen).locales = cloneJson(document.locales as unknown as JsonObject) as Record<string, JsonObject>;
        }
    }

    // State paths into moved nodes follow them
    const follow = (text: string): string => moves.reduce((moved, [from, to]) => movePath(moved, from, to), text);
    appNode = mapStrings(appNode, APP_PATH, follow) as JsonObject;
    for (const screen of Object.values(screens)) screen.root = mapStrings(screen.root as unknown as JsonObject, '$', follow) as unknown as Node;
    if (logic !== undefined) logic = mapStrings(logic, '$.logic', follow) as JsonObject;

    // The theme
    const themes: Record<string, ThemePart> = {};
    const uses: NonNullable<AppBlueprint['uses']> = {};
    if (document.theme !== undefined || document.themes !== undefined) {
        const theme = names.name('themes', appName);
        themes[theme] = {
            tokens: cloneJson(document.theme?.tokens ?? {}),
            ...(document.themes === undefined ? {} : { overlays: cloneJson(document.themes as unknown as JsonObject) as unknown as ThemePart['overlays'] })
        };
        uses.themes = [theme];
    }

    // The data: the snapshot's, else the document's
    const models: Record<string, ModelPart> = {};
    const datasets: Record<string, DatasetPart> = {};
    const bindings: Record<string, DataBinding> = {};
    const data = isObject(snapshot?.['data']) ? (snapshot['data'] as JsonObject) : (document.data ?? {});
    for (const [key, value] of Object.entries(data)) {
        const path = `$.data.${key}`;
        const records = toRecords(value, path, report);
        if (records === undefined) continue;
        const model = inferModel(records);
        const read = readModel(model as unknown as JsonValue);
        for (const error of read.errors) report.push(problem(path, `its inferred model fails: ${error.message}`));
        const dataset = names.name('data', `${appName}-${key}`, key);
        const modelName = names.name('models', dataset, key);
        models[modelName] = model;
        datasets[dataset] = { model: modelName, records };
        bindings[key] = { dataset };
    }
    if (Object.keys(bindings).length > 0) uses.data = bindings;
    if (report.length > 0) return unconverted(report, names.renamed);

    const blueprint: AppBlueprint = {
        title: input.name,
        ...(Object.keys(uses).length > 0 ? { uses } : {}),
        start,
        app: appNode as unknown as Node,
        screens,
        ...(logic === undefined ? {} : { logic: logic as unknown as LogicDocument })
    };
    return { app: { name: appName, blueprint }, themes, models, datasets, components, renamed: names.renamed, report };
}
