import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';

/* The SUI-LOCALE codes of this folder, in one place */

/** A language the application has no overlay for */
export function unknownLanguage(locale: string): BuildError {
    return buildError('SUI-LOCALE-UNKNOWN', { locale, path: '$.locale', statePath: '$.locale' });
}

/** An overlay property that is not content: a leaf that is not a `_` property, or a value that is not text */
export function notContent(locale: string, name: string, path: string): BuildError {
    return buildError('SUI-LOCALE-CONTENT', { locale, name, path, statePath: path });
}

/** An overlay property that is linked from data */
export function linkedProperty(locale: string, name: string, path: string): BuildError {
    return buildError('SUI-LOCALE-LINKED', { locale, name, path, statePath: path });
}

/** An overlay path that is not in the application */
export function missingPath(locale: string, path: string): BuildError {
    return buildError('SUI-LOCALE-PATH', { locale, path, statePath: path });
}

/** A content path the language does not translate */
export function untranslated(locale: string, path: string): BuildError {
    return buildError('SUI-LOCALE-MISSING', { locale, path, statePath: path });
}

/** The line after the cap: how many more untranslated paths there are than were listed */
export function moreUntranslated(locale: string, count: number, limit: number): BuildError {
    return buildError('SUI-LOCALE-MORE', { locale, actual: count, limit, statePath: '$.app' });
}
