import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { TOKENS_STATE_PATH } from './types.js';

const SEGMENT = /^[a-z0-9]+$/;

/** Thrown by `cssName` for a path with a bad segment; `error` is the `SUI-THEME-NAME` the catalog builds */
export class TokenNameError extends Error {
    readonly error: BuildError;

    constructor(error: BuildError) {
        super(error.message);
        this.name = 'TokenNameError';
        this.error = error;
    }
}

function nameError(name: string, path: string): BuildError {
    return buildError('SUI-THEME-NAME', { name, path, statePath: `${TOKENS_STATE_PATH}.${path}` });
}

/**
 * The custom property name of a token: the path joined with `-` and prefixed `--ui-`.
 * A segment that is not lower-case letters and digits is a `SUI-THEME-NAME` (thrown as `TokenNameError`); with
 * that pattern two different paths can never flatten to the same name
 */
export function cssName(path: string | readonly string[]): string {
    const segments = typeof path === 'string' ? path.split('.') : path;
    for (const segment of segments) {
        if (!SEGMENT.test(segment)) throw new TokenNameError(nameError(segment, segments.join('.')));
    }
    return `--ui-${segments.join('-')}`;
}

/** Returns a `SUI-THEME-NAME` for every key in the tree that is not lower-case letters and digits (a dotted key included) */
export function validateTokenNames(tree: Readonly<Record<string, unknown>>, prefix: readonly string[] = []): BuildError[] {
    const errors: BuildError[] = [];
    for (const [key, value] of Object.entries(tree)) {
        const path = [...prefix, key];
        if (!SEGMENT.test(key)) errors.push(nameError(key, path.join('.')));
        else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            errors.push(...validateTokenNames(value as Record<string, unknown>, path));
        }
    }
    return errors;
}
