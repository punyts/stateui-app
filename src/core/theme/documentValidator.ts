import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { registerDocumentValidator } from '../validate/registry.js';
import type { DocumentValidationContext } from '../validate/types.js';
import { validateTokens } from './validate.js';

/** The name the theme validator is registered under; a later story that extends it registers this name again */
export const THEME_VALIDATOR = 'theme';

function wrongType(key: string, statePath: string): BuildError {
    return buildError('SUI-DOC-TYPE', { key, path: statePath, statePath });
}

/**
 * Checks the document's `theme`: `tokens` must be an object that passes `validateTokens` (names, paths, value types,
 * injection characters and references), and `active` a map of names. An invalid token stops the run with `SUI-THEME-*`
 * before anything renders
 */
export function validateThemeTokens(context: DocumentValidationContext): BuildError[] {
    const theme = context.document.theme;
    if (typeof theme !== 'object' || theme === null) return [];
    const errors: BuildError[] = [];
    const tokens: unknown = theme.tokens;
    if (tokens !== undefined) {
        if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) {
            errors.push(wrongType('tokens', '$.theme.tokens'));
        } else {
            errors.push(...validateTokens(theme.tokens ?? {}));
        }
    }
    const active: unknown = theme.active;
    if (active !== undefined) {
        const valid =
            typeof active === 'object' &&
            active !== null &&
            !Array.isArray(active) &&
            Object.values(active).every((name) => typeof name === 'string');
        if (!valid) errors.push(wrongType('active', '$.theme.active'));
    }
    return errors;
}

registerDocumentValidator(THEME_VALIDATOR, validateThemeTokens);
