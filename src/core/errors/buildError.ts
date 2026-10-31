import { ERROR_CATALOG, type CatalogEntry, type ErrorCode } from './catalog.js';
import type { BuildError, ErrorDetails } from './types.js';

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

/**
 * Builds an error from a catalog code. The message comes from the catalog template, filled from `details`;
 * `statePath`, `component`, `file`, `line` and `column` are also copied onto the error when given.
 * A template placeholder missing from `details` is a programming error and throws
 */
export function buildError(code: ErrorCode, details: ErrorDetails = {}): BuildError {
    const entry: CatalogEntry = ERROR_CATALOG[code];
    const values: Record<string, string | number | undefined> = { ...details };
    const message = entry.template.replace(PLACEHOLDER, (_match, name: string) => {
        const value = values[name];
        if (value === undefined) throw new Error(`${code} needs the detail "${name}"`);
        return String(value);
    });

    const error: BuildError = { code, message };
    if (entry.severity) error.severity = entry.severity;
    if (details.statePath !== undefined) error.statePath = details.statePath;
    if (details.component !== undefined) error.component = String(details.component);
    if (details.file !== undefined) error.file = String(details.file);
    if (details.line !== undefined) error.line = details.line;
    if (details.column !== undefined) error.column = details.column;
    return error;
}

/** True when the errors hold no `"error"` severity; warnings never make a document invalid */
export function isValid(errors: readonly BuildError[]): boolean {
    return errors.every((error) => error.severity === 'warning');
}
