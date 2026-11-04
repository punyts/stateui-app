import { cloneJson, isObject } from '../resolve/merge.js';
import type { AppDocument, JsonObject } from '../types.js';

/**
 * Where navigation lives in the store: `screen` and `params`. It sits beside `$.app`, `$.data` and `$.theme`, never
 * under `$.app` (a key there would be a property of the shell's root component), and is not a document key
 */
export const ROUTE_PATH = '$.route';

/** The value of `$.route`: the current screen and its params */
export interface RouteState {
    screen: string;
    params: JsonObject;
}

/** The defaults of a screen's param declarations; a param without a default is left out */
export function paramDefaults(declarations: JsonObject | undefined): JsonObject {
    const params: JsonObject = {};
    for (const [name, declaration] of Object.entries(declarations ?? {})) {
        if (isObject(declaration) && declaration['default'] !== undefined) params[name] = cloneJson(declaration['default']);
    }
    return params;
}

/** The first value of `$.route`: the `start` screen with the defaults of its params; undefined for an app without screens */
export function initialRoute(document: Pick<AppDocument, 'screens' | 'start'>): RouteState | undefined {
    const { screens, start } = document;
    if (screens === undefined || start === undefined || !Object.hasOwn(screens, start)) return undefined;
    return { screen: start, params: paramDefaults(screens[start]?.params) };
}
