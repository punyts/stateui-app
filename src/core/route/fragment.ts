import { isObject } from '../resolve/merge.js';
import type { JsonObject, JsonValue } from '../types.js';
import { paramDefaults, routeTo } from './route.js';
import type { RouteScreens, RouteState } from './route.js';

/** The start of a URL fragment that names a screen: `#/product?id=p42` */
export const FRAGMENT_PREFIX = '#/';

/** A param value as text in the query: text as it is, numbers and booleans as written, anything else as JSON */
function paramText(value: JsonValue): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
}

/**
 * A param read back from the query by the type it is declared with. Text that does not fit stays text, so `routeTo`
 * refuses it as a wrong type; an undeclared param stays text and is refused as undeclared
 */
function paramValue(declaration: JsonValue | undefined, text: string): JsonValue {
    const type = isObject(declaration) ? declaration['type'] : undefined;
    if (type === 'number' || type === 'integer') {
        const number = text.trim() === '' ? Number.NaN : Number(text);
        return Number.isFinite(number) ? number : text;
    }
    if (type === 'boolean') return text === 'true' ? true : text === 'false' ? false : text;
    if (type === 'array' || type === 'object' || type === 'any') {
        try {
            return JSON.parse(text) as JsonValue;
        } catch {
            return text;
        }
    }
    return text;
}

/**
 * The URL fragment of a route: `#/{screen}` and, when a param differs from its declared default, a query of those params
 * (`#/product?id=p42`). Names and values are URL-encoded; numbers and booleans are written as text, arrays and objects
 * as JSON. `parseFragment` reads it back
 */
export function formatFragment(route: RouteState, screens: RouteScreens): string {
    const defaults = paramDefaults(Object.hasOwn(screens, route.screen) ? screens[route.screen]?.params : undefined);
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(route.params)) {
        if (Object.hasOwn(defaults, name) && JSON.stringify(defaults[name]) === JSON.stringify(value)) continue;
        query.set(name, paramText(value));
    }
    const text = query.toString();
    return `${FRAGMENT_PREFIX}${encodeURIComponent(route.screen)}${text === '' ? '' : `?${text}`}`;
}

/**
 * The route a URL fragment names, checked as `navigate` checks it (`routeTo`): the screen must exist and the params
 * must be declared and fit. Returns undefined for a fragment that does not name a screen (empty, or not starting with
 * `#/`), and the reason for one that names a screen the app cannot show
 */
export function parseFragment(hash: string, screens: RouteScreens): RouteState | { reason: string } | undefined {
    if (!hash.startsWith(FRAGMENT_PREFIX)) return undefined;
    const rest = hash.slice(FRAGMENT_PREFIX.length);
    const mark = rest.indexOf('?');
    let screen: string;
    try {
        screen = decodeURIComponent(mark < 0 ? rest : rest.slice(0, mark));
    } catch {
        return { reason: `the fragment "${hash}" is not valid URL text` };
    }
    if (screen === '') return undefined;
    const declarations = Object.hasOwn(screens, screen) ? (screens[screen]?.params ?? {}) : {};
    const params: JsonObject = {};
    for (const [name, text] of new URLSearchParams(mark < 0 ? '' : rest.slice(mark + 1))) {
        params[name] = paramValue(Object.hasOwn(declarations, name) ? declarations[name] : undefined, text);
    }
    return routeTo(screens, screen, params);
}

/** True when two routes name the same screen with the same params */
export function sameRoute(left: RouteState | undefined, right: RouteState | undefined): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
