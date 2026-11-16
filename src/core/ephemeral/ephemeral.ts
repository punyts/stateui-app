import type { JsonValue } from '../types.js';

/** The most ephemeral paths an app declares */
export const MAX_EPHEMERAL_PATHS = 50;

/** A "$." state path below `$.app`, `$.screens`, `$.data` or `$.raised`, whose segments may be `*` (any one) */
const EPHEMERAL_PATH = /^\$\.(app|screens|data|raised)(\.[^.\s*]+|\.\*)*$/;

/** One problem of an app's `ephemeral` list: where it is and why */
export interface EphemeralProblem {
    path: string;
    reason: string;
}

/**
 * The problems of an app's `ephemeral` list: the state paths (a pointer, presence, typing, a drag in progress) whose
 * changes reach everyone using the app but are never stored, and never hold up the moment a save is durable. Each is
 * a "$." path under `$.app`, `$.screens`, `$.data` or `$.raised`, `*` matching any one segment; at most
 * `MAX_EPHEMERAL_PATHS`, no repeats
 */
export function ephemeralProblems(value: JsonValue, path: string): EphemeralProblem[] {
    if (!Array.isArray(value)) return [{ path, reason: 'must be a list of state paths' }];
    const problems: EphemeralProblem[] = [];
    if (value.length > MAX_EPHEMERAL_PATHS) problems.push({ path, reason: `has more than ${MAX_EPHEMERAL_PATHS} paths` });
    const seen = new Set<string>();
    value.forEach((item, index) => {
        const at = `${path}.${index}`;
        if (typeof item !== 'string' || !EPHEMERAL_PATH.test(item)) problems.push({ path: at, reason: 'must be a state path under $.app, $.screens, $.data or $.raised, * for any one segment' });
        else if (seen.has(item)) problems.push({ path: at, reason: `"${item}" is listed twice` });
        else seen.add(item);
    });
    return problems;
}
