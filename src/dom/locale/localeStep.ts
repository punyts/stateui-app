import { buildAppOverlay, extractBaseOverlay, unknownLanguage } from '../../core/locale/index.js';
import type { ComponentOverlays } from '../../core/locale/index.js';
import { cloneJson } from '../../core/resolve/index.js';
import { screenPath } from '../../core/route/index.js';
import type { JsonObject } from '../../core/types.js';
import { registerMountStep } from '../mount/index.js';
import type { MountContext } from '../mount/index.js';
import type { BuildError } from '../../core/errors/index.js';
import { createNodeLocale } from './nodeLocale.js';
import type { NodeLocale, NodeLocaleStore } from './nodeLocale.js';
import { switchLocale } from './switchLocale.js';

const APP_PATH = '$.app';
const LOCALE_PATH = '$.locale';

/** What `registerLocaleStep` gives back: the live localizer of the mounted application */
export interface LocaleStepHandle {
    /** The overlay of `$.app` per language, base language included, as the step built it; undefined until an application is mounted */
    readonly overlays: Record<string, JsonObject> | undefined;
    /** The overlays of each screen by screen name, then language, base language included; undefined until an application is mounted */
    readonly screenOverlays: Record<string, Record<string, JsonObject>> | undefined;
    /**
     * The localizer for nodes created later, below `$.app` or a screen; undefined until an application is mounted.
     * Row creators call `prepare` on it
     */
    readonly nodes: NodeLocale | undefined;
    /** `switchLocale` over `overlays` and `screenOverlays`; returns `SUI-LOCALE-UNKNOWN` when no application is mounted or the language has no overlay */
    switchTo(code: string): BuildError[];
    /** Removes the step; an application that is already mounted keeps running with it */
    unregister(): void;
}

/** One root the step keeps: the shell at `$.app` or a screen at `$.screens.{name}` */
interface Root {
    path: string;
    tree: JsonObject;
    overrides: Readonly<Record<string, JsonObject>> | undefined;
}

function rootsOf(store: NodeLocaleStore, context: MountContext): { app: Root; screens: Record<string, Root> } {
    const { document } = context;
    const app: Root = { path: APP_PATH, tree: cloneJson(store.get(APP_PATH) as JsonObject), overrides: document.locales };
    const screens: Record<string, Root> = {};
    for (const [name, screen] of Object.entries(document.screens ?? {})) {
        const path = screenPath(name);
        screens[name] = { path, tree: cloneJson(store.get(path) as JsonObject), overrides: screen.locales };
    }
    return { app, screens };
}

/** The overlay of one root per language: the base content under `baseLocale`, then each code's component overlays and overrides */
function overlaysOf(root: Root, codes: ReadonlySet<string>, baseLocale: string, componentOverlays: ComponentOverlays, context: MountContext): Record<string, JsonObject> {
    const built: Record<string, JsonObject> = { [baseLocale]: extractBaseOverlay(root.tree, [], root.path) };
    for (const code of codes) {
        built[code] = buildAppOverlay(code, root.tree, componentOverlays, root.overrides?.[code] ?? {}, {
            library: context.library,
            composed: context.document.composed,
            instances: context.instances,
            path: root.path
        });
    }
    return built;
}

/** One localizer over several: each path goes to the localizer of the root that holds it */
function routed(localizers: ReadonlyMap<string, NodeLocale>): NodeLocale {
    const find = (path: string): NodeLocale | undefined => {
        for (const [root, localizer] of localizers) if (path === root || path.startsWith(`${root}.`)) return localizer;
        return undefined;
    };
    return {
        prepare(path, value, instances) {
            return find(path)?.prepare(path, value, instances) ?? cloneJson(value);
        },
        watch() {
            const stops = [...localizers.values()].map((localizer) => localizer.watch());
            return () => {
                for (const stop of stops) stop();
            };
        },
        forget(path) {
            find(path)?.forget(path);
        }
    };
}

/**
 * Registers the mount step that keeps the language of an application complete: when the store exists it builds the
 * overlay of each language for the shell (`$.app`) and for each screen (`$.screens.{name}`) from `componentOverlays`,
 * the document's `locales` (for the shell) or the screen's `locales`, and the base overlay of the mounted content,
 * then watches each root for nodes created later and translates them (`createNodeLocale`). A switch changes every
 * screen in the store, so a screen that is hidden or not mounted yet shows the language when it appears.
 * The step needs the document, library and instances `mountApp` already gives it, so `mountApp` is unchanged
 */
export function registerLocaleStep(componentOverlays: ComponentOverlays): LocaleStepHandle {
    let overlays: Record<string, JsonObject> | undefined;
    let screenOverlays: Record<string, Record<string, JsonObject>> | undefined;
    let nodes: NodeLocale | undefined;
    let mounted: NodeLocaleStore | undefined;

    const unregister = registerMountStep('locale-nodes', {
        start(context) {
            const store = context.store as unknown as NodeLocaleStore;
            const baseLocale = String(store.get(LOCALE_PATH));
            const roots = rootsOf(store, context);
            const codes = new Set<string>(Object.keys(context.document.locales ?? {}));
            for (const byCode of Object.values(componentOverlays)) for (const code of Object.keys(byCode)) codes.add(code);
            for (const root of Object.values(roots.screens)) for (const code of Object.keys(root.overrides ?? {})) codes.add(code);
            codes.delete(baseLocale);

            const localizers = new Map<string, NodeLocale>();
            const localize = (root: Root): Record<string, JsonObject> => {
                const built = overlaysOf(root, codes, baseLocale, componentOverlays, context);
                localizers.set(
                    root.path,
                    createNodeLocale({
                        store,
                        overlays: built,
                        baseLocale,
                        componentOverlays,
                        appOverrides: root.overrides,
                        library: context.library,
                        composed: context.document.composed,
                        instances: context.instances,
                        root: root.path
                    })
                );
                return built;
            };
            const built = localize(roots.app);
            const builtScreens: Record<string, Record<string, JsonObject>> = {};
            for (const [name, root] of Object.entries(roots.screens)) builtScreens[name] = localize(root);

            const localizer = routed(localizers);
            const stop = localizer.watch();
            overlays = built;
            screenOverlays = builtScreens;
            nodes = localizer;
            mounted = store;
            return () => {
                stop();
                if (nodes === localizer) {
                    nodes = undefined;
                    overlays = undefined;
                    screenOverlays = undefined;
                    mounted = undefined;
                }
            };
        }
    });

    return {
        get overlays() {
            return overlays;
        },
        get screenOverlays() {
            return screenOverlays;
        },
        get nodes() {
            return nodes;
        },
        switchTo(code) {
            return mounted === undefined || overlays === undefined ? [unknownLanguage(code)] : switchLocale(mounted, code, overlays, screenOverlays);
        },
        unregister
    };
}
