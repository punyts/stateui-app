import { buildAppOverlay, extractBaseOverlay, unknownLanguage } from '../../core/locale/index.js';
import type { ComponentOverlays } from '../../core/locale/index.js';
import { cloneJson } from '../../core/resolve/index.js';
import type { JsonObject } from '../../core/types.js';
import { registerMountStep } from '../mount/index.js';
import type { BuildError } from '../../core/errors/index.js';
import { createNodeLocale } from './nodeLocale.js';
import type { NodeLocale, NodeLocaleStore } from './nodeLocale.js';
import { switchLocale } from './switchLocale.js';

const APP_PATH = '$.app';
const LOCALE_PATH = '$.locale';

/** What `registerLocaleStep` gives back: the live localizer of the mounted application */
export interface LocaleStepHandle {
    /** The overlay per language, base language included, as the step built it; undefined until an application is mounted */
    readonly overlays: Record<string, JsonObject> | undefined;
    /** The localizer for nodes created later; undefined until an application is mounted. Row creators call `prepare` on it */
    readonly nodes: NodeLocale | undefined;
    /** `switchLocale` over `overlays`; returns `SUI-LOCALE-UNKNOWN` when no application is mounted or the language has no overlay */
    switchTo(code: string): BuildError[];
    /** Removes the step; an application that is already mounted keeps running with it */
    unregister(): void;
}

/**
 * Registers the mount step that keeps the language of an application complete: when the store exists it builds the
 * overlay of each language from `componentOverlays` and the document's `locales` (and the base overlay of the
 * mounted content), then watches `$.app` for nodes created later and translates them (`createNodeLocale`).
 * The step needs the document, library and instances `mountApp` already gives it, so `mountApp` is unchanged
 */
export function registerLocaleStep(componentOverlays: ComponentOverlays): LocaleStepHandle {
    let overlays: Record<string, JsonObject> | undefined;
    let nodes: NodeLocale | undefined;
    let mounted: NodeLocaleStore | undefined;

    const unregister = registerMountStep('locale-nodes', {
        start(context) {
            const store = context.store as unknown as NodeLocaleStore;
            const app = cloneJson(store.get(APP_PATH) as JsonObject);
            const baseLocale = String(store.get(LOCALE_PATH));
            const built: Record<string, JsonObject> = { [baseLocale]: extractBaseOverlay(app, []) };
            const codes = new Set<string>(Object.keys(context.document.locales ?? {}));
            for (const byCode of Object.values(componentOverlays)) for (const code of Object.keys(byCode)) codes.add(code);
            codes.delete(baseLocale);
            for (const code of codes) {
                built[code] = buildAppOverlay(code, app, componentOverlays, context.document.locales?.[code] ?? {}, {
                    library: context.library,
                    composed: context.document.composed,
                    instances: context.instances
                });
            }
            const localizer = createNodeLocale({
                store,
                overlays: built,
                baseLocale,
                componentOverlays,
                appOverrides: context.document.locales,
                library: context.library,
                composed: context.document.composed,
                instances: context.instances
            });
            const stop = localizer.watch();
            overlays = built;
            nodes = localizer;
            mounted = store;
            return () => {
                stop();
                if (nodes === localizer) {
                    nodes = undefined;
                    overlays = undefined;
                    mounted = undefined;
                }
            };
        }
    });

    return {
        get overlays() {
            return overlays;
        },
        get nodes() {
            return nodes;
        },
        switchTo(code) {
            return mounted === undefined || overlays === undefined ? [unknownLanguage(code)] : switchLocale(mounted, code, overlays);
        },
        unregister
    };
}
