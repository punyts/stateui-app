import type { BuildError } from '../core/errors/index.js';

/** One line per error: `file:line:column severity CODE message`, with the location parts that exist */
export function formatError(error: BuildError): string {
    let location = error.file ?? '';
    if (error.line !== undefined) location += `:${error.line}`;
    if (error.column !== undefined) location += `:${error.column}`;
    const severity = error.severity === 'warning' ? 'warning' : 'error';
    return `${location === '' ? '' : `${location} `}${severity} ${error.code} ${error.message}`;
}
