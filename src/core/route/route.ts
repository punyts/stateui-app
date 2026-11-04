import { nearestNames } from '../assemble/nearest.js';
import { cloneJson, isObject } from '../resolve/merge.js';
import { fitsType } from '../shape/fit.js';
import type { PropertyType } from '../shape/index.js';
import { passesValidators } from '../shape/validators.js';
import type { ValidatorOptions } from '../shape/index.js';
import type { AppDocument, DocumentScreen, JsonObject, JsonValue } from '../types.js';

/**
 * Where navigation lives in the store: `screen` and `params`. It sits beside `$.app`, `$.data` and `$.theme`, never
 * under `$.app` (a key there would be a property of the shell's root component), and is not a document key
 */
export const ROUTE_PATH = '$.route';

/** The command that moves `$.route` to another screen, in logic and in `on` entries */
export const NAVIGATE_COMMAND = 'navigate';

/** The value of `$.route`: the current screen and its params */
export interface RouteState {
    screen: string;
    params: JsonObject;
}

/** The screens of a document, by name */
export type RouteScreens = Readonly<Record<string, Pick<DocumentScreen, 'params'>>>;

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

/** Why a value does not fit a param declaration, or undefined when it fits */
function misfit(name: string, declaration: JsonValue | undefined, value: JsonValue): string | undefined {
    if (!isObject(declaration)) return `param "${name}" is not declared`;
    const type = declaration['type'];
    if (typeof type === 'string' && !fitsType(type as Exclude<PropertyType, 'map'>, value)) return `param "${name}" must be ${type}`;
    const validators = declaration['validators'];
    if (isObject(validators) && !passesValidators(value, validators as ValidatorOptions)) return `param "${name}" fails its validators`;
    return undefined;
}

/** Why a screen name is unknown, with the nearest names */
function unknownScreen(screens: RouteScreens | undefined, screen: string): string {
    if (screens === undefined) return `the app has no screens, so it cannot navigate to "${screen}"`;
    const near = nearestNames(screen, Object.keys(screens));
    return `no screen is named "${screen}"${near.length > 0 ? `; nearest: ${near.join(', ')}` : ''}`;
}

/**
 * The route `navigate` writes: `screen` with the defaults of its params and the given params over them. Returns the
 * reason instead when the screen does not exist, `params` is not an object, a param is not declared or does not fit
 * its declaration, or a required param without a default is missing
 */
export function routeTo(screens: RouteScreens | undefined, screen: string, params: JsonValue | undefined): RouteState | { reason: string } {
    if (screens === undefined || !Object.hasOwn(screens, screen)) return { reason: unknownScreen(screens, screen) };
    if (params !== undefined && params !== null && !isObject(params)) return { reason: 'the params of navigate must be an object' };
    const declarations = screens[screen]?.params ?? {};
    const given = isObject(params) ? params : {};
    for (const [name, value] of Object.entries(given)) {
        const reason = misfit(name, Object.hasOwn(declarations, name) ? declarations[name] : undefined, value);
        if (reason !== undefined) return { reason: `${reason} on screen "${screen}"` };
    }
    const route: RouteState = { screen, params: { ...paramDefaults(declarations), ...cloneJson(given) } };
    for (const [name, declaration] of Object.entries(declarations)) {
        if (isObject(declaration) && declaration['required'] === true && !Object.hasOwn(route.params, name)) {
            return { reason: `param "${name}" of screen "${screen}" is required` };
        }
    }
    return route;
}

/** True when `value` is a reason from `routeTo` */
export function isRouteRefusal(value: RouteState | { reason: string }): value is { reason: string } {
    return Object.hasOwn(value, 'reason');
}

/** True when a param value is only known when the command runs: a template, a reference or a `$` value */
function isDynamic(value: JsonValue): boolean {
    return typeof value === 'string' && (value.startsWith('$') || value.startsWith('^') || value.includes('{{'));
}

/** What a document check finds wrong with a `navigate` command: the code and the reason */
export interface NavigateProblem {
    code: 'SUI-ROUTE-SCREEN' | 'SUI-ROUTE-PARAMS';
    reason: string;
}

/**
 * Checks a `navigate` command before it runs: the target must be a screen (a template target is not checked), and
 * the literal params must be declared and fit; a param whose value is only known at run time is checked by name only
 */
export function checkNavigate(screens: RouteScreens | undefined, target: JsonValue | undefined, params: JsonValue | undefined): NavigateProblem | undefined {
    if (typeof target !== 'string' || target === '') return { code: 'SUI-ROUTE-SCREEN', reason: 'navigate needs the screen name as its target' };
    if (target.includes('{{')) return undefined;
    if (screens === undefined || !Object.hasOwn(screens, target)) return { code: 'SUI-ROUTE-SCREEN', reason: unknownScreen(screens, target) };
    if (params !== undefined && params !== null && !isObject(params)) {
        return isDynamic(params) ? undefined : { code: 'SUI-ROUTE-PARAMS', reason: 'the params of navigate must be an object' };
    }
    const declarations = screens[target]?.params ?? {};
    const given = isObject(params) ? params : {};
    for (const [name, value] of Object.entries(given)) {
        const declaration = Object.hasOwn(declarations, name) ? declarations[name] : undefined;
        const reason = isDynamic(value) ? (isObject(declaration) ? undefined : `param "${name}" is not declared`) : misfit(name, declaration, value);
        if (reason !== undefined) return { code: 'SUI-ROUTE-PARAMS', reason: `${reason} on screen "${target}"` };
    }
    for (const [name, declaration] of Object.entries(declarations)) {
        if (isObject(declaration) && declaration['required'] === true && declaration['default'] === undefined && !Object.hasOwn(given, name)) {
            return { code: 'SUI-ROUTE-PARAMS', reason: `param "${name}" of screen "${target}" is required` };
        }
    }
    return undefined;
}
