import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { isObject } from '../resolve/merge.js';
import { NAVIGATE_COMMAND, checkNavigate } from '../route/index.js';
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

/**
 * Checks every `navigate` command, in the logic and in the `on` entries of the shell, the screens and the composed
 * components they expand: the target must name a screen (`SUI-ROUTE-SCREEN`) and literal params must be declared and
 * fit (`SUI-ROUTE-PARAMS`). A command that takes its params `from` a path is checked for its screen only
 */
export function validateRoutes(context: DocumentValidationContext): BuildError[] {
    const errors: BuildError[] = [];
    const screens = context.document.screens;
    const visit = (command: Record<string, JsonValue>, path: string): void => {
        const problem = checkNavigate(screens, command['target'], Object.hasOwn(command, 'from') ? undefined : command['value']);
        if (problem !== undefined) errors.push(buildError(problem.code, { path, statePath: path, reason: problem.reason }));
    };
    findNavigates(context.tree.node, '$.app', visit);
    for (const [name, tree] of Object.entries(context.screens ?? {})) findNavigates(tree.node, `$.screens.${name}`, visit);
    findNavigates(context.document.logic as JsonValue | undefined, '$.logic', visit);
    return errors;
}
