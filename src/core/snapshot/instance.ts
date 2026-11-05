import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { cloneJson, isObject } from '../resolve/merge.js';
import { initialRoute, isRouteRefusal, routeTo } from '../route/index.js';
import type { RouteState } from '../route/index.js';
import { OVERLAY_KINDS, SYSTEM, SYSTEM_KINDS, THEME_KEY, buildOverlayCatalog, hasAppTheme, hasOverlay, startTheme, themeSource } from '../theme/index.js';
import type { OverlayKind } from '../theme/index.js';
import { PREFIXES, RESERVED_KEYS } from '../types.js';
import type { AppDocument, JsonObject, JsonValue } from '../types.js';

/**
 * What one persona did in an app: the articulation of the shell (`app`) and of each screen (`screens`, by name), the
 * route, the active overlay names and the persona's data. Shaped like a `StateSnapshot`; every part is sparse
 */
export interface AppInstance {
    app: JsonObject;
    screens: JsonObject;
    route?: RouteState;
    theme?: { active?: Record<string, string> };
    data?: JsonObject;
}

/** The definition's own starting values, before an instance is laid over them; never changed */
export interface InstanceBase {
    /** The resolved shell tree */
    app: JsonObject;
    /** Each screen's resolved root by name */
    screens?: Readonly<Record<string, JsonObject>>;
    data: JsonObject;
}

export interface LaidInstance {
    app: JsonObject;
    screens?: Record<string, JsonObject>;
    data: JsonObject;
    /** The instance's route when the app still has its screen and the params fit; otherwise the start route */
    route?: RouteState;
    /** The instance's active overlay names the app still has; the theme step lays them over the document's */
    active: Record<string, string>;
    /** `SUI-INSTANCE-STALE` warnings for the values that were dropped */
    warnings: BuildError[];
}

/** The keys of a node that belong to the definition, never to an instance */
const STRUCTURE: readonly string[] = [RESERVED_KEYS.component, RESERVED_KEYS.layout, RESERVED_KEYS.placement, RESERVED_KEYS.theme, RESERVED_KEYS.on];

/**
 * Lays an articulation overlay on a copy of a node tree: an object recurses, any other value replaces. Only keys the
 * definition has are laid, so a value of a node or property the app no longer has is dropped; content (`_` keys),
 * links (`<-` keys) and the node structure (`component`, `on`, `layout`, `placement`, `theme`) are never laid
 */
function layTree(base: JsonObject, overlay: JsonObject): JsonObject {
    const result = cloneJson(base) as JsonObject;
    const isNode = typeof base[RESERVED_KEYS.component] === 'string';
    for (const [key, value] of Object.entries(overlay)) {
        if (!Object.hasOwn(base, key) || key.startsWith(PREFIXES.content) || key.startsWith(PREFIXES.link)) continue;
        if (isNode && STRUCTURE.includes(key)) continue;
        const own = base[key] as JsonValue;
        result[key] = isObject(own) && isObject(value) ? layTree(own, value) : cloneJson(value);
    }
    return result;
}

/** Lays data over a copy of data: an object recurses, any other value replaces, and new keys (records) are added */
function layData(base: JsonObject, overlay: JsonObject): JsonObject {
    const result = cloneJson(base) as JsonObject;
    for (const [key, value] of Object.entries(overlay)) {
        const own = result[key];
        result[key] = isObject(own) && isObject(value) ? layData(own, value) : cloneJson(value);
    }
    return result;
}

function stale(target: string, path: string, reason: string): BuildError {
    return buildError('SUI-INSTANCE-STALE', { target, path, reason, statePath: path });
}

/**
 * The definition's starting values with a persona's instance laid over them. The base and the instance are never
 * changed. Values of nodes and screens the definition no longer has are dropped without a word: they are what a person
 * did with a part that is gone. A route to a screen the app no longer has (or whose params no longer fit) falls back to
 * the start route, a theme (`theme.active.theme`) the app no longer lists falls back to its first, and an active overlay
 * name the theme the app opens with does not have falls back to the document's; each is a
 * `SUI-INSTANCE-STALE` warning
 */
export function layInstance(
    base: InstanceBase,
    instance: AppInstance,
    document: Pick<AppDocument, 'screens' | 'start' | 'theme' | 'themes' | 'appThemes'>
): LaidInstance {
    const warnings: BuildError[] = [];
    const app = isObject(instance.app) ? layTree(base.app, instance.app) : (cloneJson(base.app) as JsonObject);

    let screens: Record<string, JsonObject> | undefined;
    if (base.screens !== undefined) {
        screens = {};
        const given = isObject(instance.screens) ? instance.screens : {};
        for (const [name, root] of Object.entries(base.screens)) {
            const overlay = given[name];
            screens[name] = isObject(overlay) ? layTree(root, overlay) : (cloneJson(root) as JsonObject);
        }
    }

    const data = isObject(instance.data) ? layData(base.data, instance.data) : (cloneJson(base.data) as JsonObject);

    const start = initialRoute(document);
    let route = start;
    if (instance.route !== undefined && start !== undefined) {
        const target = routeTo(document.screens, instance.route.screen, instance.route.params);
        if (isRouteRefusal(target)) {
            const known = Object.hasOwn(document.screens ?? {}, instance.route.screen);
            const what = known ? `params for the screen "${instance.route.screen}"` : `the screen "${instance.route.screen}"`;
            warnings.push(stale(what, '$.route', `the app opens its start screen "${start.screen}"`));
        } else route = target;
    }

    const active: Record<string, string> = {};
    const given = instance.theme?.active ?? {};
    const requested = given[THEME_KEY];
    if (requested !== undefined && document.appThemes !== undefined) {
        if (hasAppTheme(document, requested)) active[THEME_KEY] = requested;
        else warnings.push(stale(`the theme "${requested}"`, `$.theme.active.${THEME_KEY}`, `the app opens its theme "${startTheme(document) as string}"`));
    }
    // The overlay names are looked up in the theme the app opens with
    const { overlays } = buildOverlayCatalog(themeSource(document, startTheme(document, active[THEME_KEY])).overlays);
    for (const [kind, name] of Object.entries(given)) {
        if (kind === THEME_KEY && document.appThemes !== undefined) continue;
        const path = `$.theme.active.${kind}`;
        const known = (OVERLAY_KINDS as readonly string[]).includes(kind);
        if (known && (hasOverlay(overlays, kind, name) || (name === SYSTEM && SYSTEM_KINDS.includes(kind as OverlayKind)))) {
            active[kind] = name;
        } else {
            const what = known ? `the ${kind} overlay "${name}"` : `the overlay kind "${kind}"`;
            warnings.push(stale(what, path, 'the app keeps its own choice'));
        }
    }

    return { app, ...(screens === undefined ? {} : { screens }), data, ...(route === undefined ? {} : { route }), active, warnings };
}

/**
 * The paths whose value differs between two states, as a sparse object: an object recurses, any other value that
 * differs (arrays compared whole) is taken from `current`, and a key `current` no longer has is `null`. Two equal
 * states give `{}`. Neither input is changed
 */
export function diffInstance(definition: Readonly<JsonObject>, current: Readonly<JsonObject>): JsonObject {
    const diff: JsonObject = {};
    for (const [key, value] of Object.entries(current)) {
        const own = definition[key];
        if (isObject(own) && isObject(value)) {
            const inner = diffInstance(own, value);
            if (Object.keys(inner).length > 0) diff[key] = inner;
        } else if (own === undefined || JSON.stringify(own) !== JSON.stringify(value)) diff[key] = cloneJson(value);
    }
    for (const key of Object.keys(definition)) {
        if (!Object.hasOwn(current, key)) diff[key] = null;
    }
    return diff;
}
