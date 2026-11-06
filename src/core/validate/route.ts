import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { isObject } from '../resolve/merge.js';
import { NAVIGATE_COMMAND, OUTLET_COMPONENT, checkNavigate } from '../route/index.js';
import { RESERVED_KEYS } from '../types.js';
import type { JsonValue } from '../types.js';
import type { DocumentValidationContext } from './types.js';

/** Calls `visit` with every object below `value` whose `command` is `navigate`, and its path */
function findNavigates(value: JsonValue | undefined, path: string, visit: (command: Record<string, JsonValue>, path: string) => void): void {
    if (Array.isArray(value)) {
        value.forEach((item, index) => findNavigates(item, `${path}.${index}`, visit));
        return;
    }
    if (!isObject(value)) return;
    if (value['command'] === NAVIGATE_COMMAND) visit(value, path);
    for (const [key, item] of Object.entries(value)) findNavigates(item, `${path}.${key}`, visit);
}

/** The property a component names a screen to show with, as `link` and `menuItem` do */
const SCREEN_PROPERTY = 'screen';

/**
 * Calls `visit` with every node below `value` whose component declares a string `screen` property and sets it to a
 * literal name, and the node's path; `on` entries are not nodes and are skipped
 */
function findScreenProperties(value: JsonValue | undefined, path: string, context: DocumentValidationContext, visit: (node: Record<string, JsonValue>, path: string) => void): void {
    if (Array.isArray(value)) {
        value.forEach((item, index) => findScreenProperties(item, `${path}.${index}`, context, visit));
        return;
    }
    if (!isObject(value)) return;
    const component = value[RESERVED_KEYS.component];
    const entry = typeof component === 'string' && Object.hasOwn(context.library, component) ? context.library[component] : undefined;
    const screen = value[SCREEN_PROPERTY];
    if (entry?.tier === 'root' && entry.shape.properties[SCREEN_PROPERTY]?.type === 'string' && typeof screen === 'string' && screen !== '') visit(value, path);
    for (const [key, item] of Object.entries(value)) {
        if (key !== RESERVED_KEYS.on) findScreenProperties(item, `${path}.${key}`, context, visit);
    }
}

/**
 * Checks every `navigate` command, in the logic and in the `on` entries of the shell, the screens and the composed
 * components they expand: the target must name a screen (`SUI-ROUTE-SCREEN`) and literal params must be declared and
 * fit (`SUI-ROUTE-PARAMS`). A command that takes its params `from` a path is checked for its screen only. A node whose
 * component has a string `screen` property (`link`, `menuItem`) is checked the same way, with its `params` property
 */
export function validateRoutes(context: DocumentValidationContext): BuildError[] {
    const errors: BuildError[] = [];
    const screens = context.document.screens;
    const visit = (command: Record<string, JsonValue>, path: string): void => {
        const problem = checkNavigate(screens, command['target'], Object.hasOwn(command, 'from') ? undefined : command['value']);
        if (problem !== undefined) errors.push(buildError(problem.code, { path, statePath: path, reason: problem.reason }));
    };
    const visitNode = (node: Record<string, JsonValue>, path: string): void => {
        const problem = checkNavigate(screens, node[SCREEN_PROPERTY], node['params']);
        const at = `${path}.${problem?.code === 'SUI-ROUTE-SCREEN' ? SCREEN_PROPERTY : 'params'}`;
        if (problem !== undefined) errors.push(buildError(problem.code, { path: at, statePath: at, reason: problem.reason }));
    };
    findNavigates(context.tree.node, '$.app', visit);
    findScreenProperties(context.tree.node, '$.app', context, visitNode);
    for (const [name, tree] of Object.entries(context.screens ?? {})) {
        findNavigates(tree.node, `$.screens.${name}`, visit);
        findScreenProperties(tree.node, `$.screens.${name}`, context, visitNode);
    }
    findNavigates(context.document.logic as JsonValue | undefined, '$.logic', visit);
    return errors;
}

/** The paths of every `outlet` node below `value`, depth first in key order, not looking inside `on` entries */
function findOutlets(value: JsonValue | undefined, path: string, found: string[] = []): string[] {
    if (Array.isArray(value)) {
        value.forEach((item, index) => findOutlets(item, `${path}.${index}`, found));
        return found;
    }
    if (!isObject(value)) return found;
    if (value[RESERVED_KEYS.component] === OUTLET_COMPONENT) found.push(path);
    for (const [key, item] of Object.entries(value)) {
        if (key !== RESERVED_KEYS.on) findOutlets(item, `${path}.${key}`, found);
    }
    return found;
}

function outletError(path: string, reason: string): BuildError {
    return buildError('SUI-SHELL-OUTLET', { path, statePath: path, reason });
}

/**
 * Checks where the screens show (`SUI-SHELL-OUTLET`): in an app with screens the resolved shell holds exactly one
 * `outlet` node (one a composed component brings counts), and no screen holds one. An app without screens is not
 * checked, so an `outlet` there is an ordinary empty node
 */
export function validateOutlets(context: DocumentValidationContext): BuildError[] {
    if (!isObject(context.document.screens as JsonValue | undefined)) return [];
    const errors: BuildError[] = [];
    const inShell = findOutlets(context.tree.node, '$.app');
    if (inShell.length === 0) errors.push(outletError('$.app', 'the shell of an app with screens needs one outlet node to show them in'));
    for (const extra of inShell.slice(1)) errors.push(outletError(extra, `the shell has more than one outlet; the screens show in ${inShell[0]}`));
    for (const [name, tree] of Object.entries(context.screens ?? {})) {
        for (const path of findOutlets(tree.node, `$.screens.${name}`)) errors.push(outletError(path, 'only the shell holds an outlet; a screen cannot'));
    }
    return errors;
}
