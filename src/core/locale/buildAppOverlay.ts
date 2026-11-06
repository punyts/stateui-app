import { buildDefaults } from '../shape/index.js';
import { cloneJson, entryShape, mergeValues, resolveNode } from '../resolve/index.js';
import type { ComponentLibrary, DocumentComposed } from '../resolve/index.js';
import { isNodeValue, isObject } from '../resolve/merge.js';
import type { JsonObject, JsonValue } from '../types.js';
import { isContentKey } from './extractBaseOverlay.js';

const ROOT_PATH = '$.app';

/** The overlays of every component by name, then by language code; a composed component's is relative to its tree root */
export type ComponentOverlays = Readonly<Record<string, Readonly<Record<string, JsonObject>>>>;

export interface AppOverlayOptions {
    /**
     * The components of the document. With it a component's overlay replaces only content that still holds the
     * component's own default, so text the author wrote is never overwritten; without it every path the node has is replaced
     */
    library?: ComponentLibrary;
    /** The document's `composed` entries; they come before the library */
    composed?: DocumentComposed;
    /** `ResolveResult.instances`: where composed components were expanded. Without it composed overlays are not applied */
    instances?: Readonly<Record<string, readonly string[]>>;
    /** `ExtractResult.linkedPaths`: a linked property shows data, so no overlay sets it */
    linkedPaths?: readonly string[];
    /** The state path of the application root; `$.app` when absent */
    path?: string;
}

/** One component's share of the overlay, placed at the node it belongs to */
interface Layer {
    path: string;
    overlay: JsonObject;
    /** `undefined` for the root component of the node; otherwise the position in the node's composed names, outermost first */
    composedIndex?: number;
}

function depthOf(path: string): number {
    return path.split('.').length;
}

class Assembler {
    private readonly linked: ReadonlySet<string>;
    readonly rootPath: string;

    constructor(
        private readonly code: string,
        private readonly components: ComponentOverlays,
        private readonly options: AppOverlayOptions
    ) {
        this.linked = new Set(options.linkedPaths ?? []);
        this.rootPath = options.path ?? ROOT_PATH;
    }

    private overlayOf(name: string): JsonObject | undefined {
        const byCode = Object.hasOwn(this.components, name) ? this.components[name] : undefined;
        return byCode !== undefined && Object.hasOwn(byCode, this.code) ? byCode[this.code] : undefined;
    }

    /**
     * The part of `overlay` that applies to `node`: keys the node has that are not linked and, when `check` is set,
     * still equal the default. A content map is checked entry by entry; `inContent` is set inside one (a content key holding an
     * object), where every text entry is content whatever its key is called (`_errors.required`)
     */
    private pick(overlay: JsonObject, node: JsonObject, defaults: JsonValue | undefined, check: boolean, path: string, inContent = false): JsonObject {
        const picked: JsonObject = {};
        for (const [key, value] of Object.entries(overlay)) {
            const itemPath = `${path}.${key}`;
            if (this.linked.has(itemPath) || !Object.hasOwn(node, key)) continue;
            const current = node[key] as JsonValue;
            const original = isObject(defaults) && Object.hasOwn(defaults, key) ? defaults[key] : undefined;
            if (typeof value === 'string') {
                if ((inContent || isContentKey(key)) && (!check || current === original)) picked[key] = value;
            } else if (isObject(value) && isObject(current)) {
                const inner = this.pick(value, current, original, check, itemPath, inContent || isContentKey(key));
                if (Object.keys(inner).length > 0) picked[key] = inner;
            }
        }
        return picked;
    }

    private rootLayer(node: JsonObject & { component: string }, path: string): Layer | undefined {
        const overlay = this.overlayOf(node.component);
        if (overlay === undefined) return undefined;
        const { library } = this.options;
        const entry = library !== undefined && Object.hasOwn(library, node.component) ? library[node.component] : undefined;
        const shape = entryShape(entry);
        const defaults = shape === undefined ? undefined : buildDefaults(shape);
        const picked = this.pick(overlay, node, defaults, library !== undefined, path);
        return Object.keys(picked).length === 0 ? undefined : { path, overlay: picked };
    }

    private composedLayers(node: JsonObject, path: string, names: readonly string[]): Layer[] {
        const layers: Layer[] = [];
        const { library } = this.options;
        names.forEach((name, composedIndex) => {
            const overlay = this.overlayOf(name);
            if (overlay === undefined) return;
            const defaults =
                library === undefined ? undefined : resolveNode({ component: name }, library, this.options.composed ?? {}, { path }).node;
            const picked = this.pick(overlay, node, defaults, library !== undefined, path);
            if (Object.keys(picked).length > 0) layers.push({ path, overlay: picked, composedIndex });
        });
        return layers;
    }

    collect(value: JsonValue, path: string, layers: Layer[]): void {
        if (!isObject(value)) return;
        if (isNodeValue(value)) {
            const root = this.rootLayer(value, path);
            if (root !== undefined) layers.push(root);
            const { instances } = this.options;
            const names = instances !== undefined && Object.hasOwn(instances, path) ? instances[path] : undefined;
            if (names !== undefined) layers.push(...this.composedLayers(value, path, names));
        }
        for (const [key, item] of Object.entries(value)) this.collect(item, `${path}.${key}`, layers);
    }

    /** Root components first; then composed ones from the deepest node outward, and at one node from the innermost out */
    static order(layers: readonly Layer[]): Layer[] {
        const rank = (layer: Layer): [number, number, number] =>
            layer.composedIndex === undefined ? [0, 0, 0] : [1, -depthOf(layer.path), -layer.composedIndex];
        return [...layers].sort((a, b) => {
            const left = rank(a);
            const right = rank(b);
            return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
        });
    }

    /** The overlay wrapped in the keys that lead from the application root to `path` */
    place(path: string, overlay: JsonObject): JsonObject {
        const segments = path
            .slice(this.rootPath.length)
            .split('.')
            .filter((segment) => segment !== '');
        let placed: JsonObject = overlay;
        for (const segment of segments.reverse()) placed = { [segment]: placed };
        return placed;
    }
}

/**
 * Assembles the overlay of one language for the whole application: for every node, the overlay of its root component
 * and of each composed component it was expanded from, then the document's own `locales[code]` (`appOverrides`) on
 * top. `componentOverlays` holds each component's overlay by name and language (the `<name>.locale.<code>.json`
 * files the build emits); a composed component used several times is translated once and applied at each instance,
 * and an outer composed component wins over the one inside it. Only paths the node has are taken, so a component's
 * overlay never adds a key. Pass the result to `switchLocale` under `code`. Pure; nothing passed in is changed
 */
export function buildAppOverlay(
    code: string,
    resolvedApp: JsonObject,
    componentOverlays: ComponentOverlays,
    appOverrides: JsonObject,
    options: AppOverlayOptions = {}
): JsonObject {
    const assembler = new Assembler(code, componentOverlays, options);
    const layers: Layer[] = [];
    assembler.collect(resolvedApp, assembler.rootPath, layers);
    let overlay: JsonObject = {};
    for (const layer of Assembler.order(layers)) {
        overlay = mergeValues(overlay, assembler.place(layer.path, layer.overlay)) as JsonObject;
    }
    return mergeValues(overlay, cloneJson(appOverrides)) as JsonObject;
}
