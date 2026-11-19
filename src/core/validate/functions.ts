import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { functionPaths } from '../functions/table.js';
import type { DocumentValidationContext } from './types.js';

/** The logic is read by `readLogic`, which checks each function against the kind of unit that names it */
const CHECKED_ELSEWHERE = new Set(['logic']);

/** True when the server runs anything at the path; a lookup without `entry` is asked for an expression function */
function runs(context: DocumentValidationContext, path: string): boolean {
    const functions = context.functions;
    if (functions === undefined) return true;
    return functions.entry !== undefined ? functions.entry(path) !== undefined : functions.has(path, 'expression');
}

/**
 * `SUI-LOGIC-FUNCTION` for each string outside the logic that names a function this server does not run: a template
 * call such as `{{ $.functions.text.upper($.data.name) }}` in a node, a composed component or a screen. One warning per
 * path and function. Without `functions` in the context nothing is checked
 */
export function validateFunctions(context: DocumentValidationContext): BuildError[] {
    if (context.functions === undefined) return [];
    const warnings: BuildError[] = [];
    const visit = (value: unknown, path: string): void => {
        if (typeof value === 'string') {
            for (const name of functionPaths(value)) {
                if (!runs(context, name)) warnings.push(buildError('SUI-LOGIC-FUNCTION', { path, name, statePath: path }));
            }
        } else if (Array.isArray(value)) {
            value.forEach((item, index) => visit(item, `${path}.${index}`));
        } else if (value !== null && typeof value === 'object') {
            for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`);
        }
    };
    for (const [key, value] of Object.entries(context.document)) {
        if (!CHECKED_ELSEWHERE.has(key)) visit(value, `$.${key}`);
    }
    return warnings;
}
