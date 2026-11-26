import type { JsonValue } from '../types.js';

/** The most ephemeral paths an app declares */
export const MAX_EPHEMERAL_PATHS = 50;

/**
 * The most paths an assembled document lists in `ephemeral`, `local` or `secret`: the app's own ephemeral paths and
 * the paths its nodes' metadata compiles to, one per marked property of every node (a button's `pressed`)
 */
export const MAX_MARKED_PATHS = 2000;

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
 * `max` (`MAX_EPHEMERAL_PATHS` for the list an app declares), no repeats
 */
export function ephemeralProblems(value: JsonValue, path: string, max = MAX_EPHEMERAL_PATHS): EphemeralProblem[] {
    if (!Array.isArray(value)) return [{ path, reason: 'must be a list of state paths' }];
    const problems: EphemeralProblem[] = [];
    if (value.length > max) problems.push({ path, reason: `has more than ${max} paths` });
    const seen = new Set<string>();
    value.forEach((item, index) => {
        const at = `${path}.${index}`;
        if (typeof item !== 'string' || !EPHEMERAL_PATH.test(item)) problems.push({ path: at, reason: 'must be a state path under $.app, $.screens, $.data or $.raised, * for any one segment' });
        else if (seen.has(item)) problems.push({ path: at, reason: `"${item}" is listed twice` });
        else seen.add(item);
    });
    return problems;
}
