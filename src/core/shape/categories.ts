/**
 * The categories a component may have, in the order the category index lists them. One list for the library build
 * (a typo is `SUI-BUILD-CATEGORY`), the search tools and the server instructions
 */
export const COMPONENT_CATEGORIES = Object.freeze(['layout', 'navigation', 'forms', 'data', 'feedback', 'overlays', 'content', 'conversation', 'graphics'] as const);

export type ComponentCategory = (typeof COMPONENT_CATEGORIES)[number];

export function isComponentCategory(value: unknown): value is ComponentCategory {
    return typeof value === 'string' && (COMPONENT_CATEGORIES as readonly string[]).includes(value);
}

/** Fewest purpose phrases a component lists */
export const MIN_PURPOSES = 3;

/** Most purpose phrases a component lists */
export const MAX_PURPOSES = 8;

/** Longest purpose phrase, in characters */
export const MAX_PURPOSE_LENGTH = 60;

/**
 * The phrase rule of `purposes`, shared by the shape parser, the composed parser, patterns and owner components:
 * an array of three to eight strings, each non-empty after trim, on one line and at most 60 characters. Returns what
 * is wrong as a short phrase ("must list 3 to 8 phrases"), or `undefined` when the value passes
 */
export function checkPurposes(value: unknown): string | undefined {
    if (!Array.isArray(value)) return 'must be an array of phrases';
    if (value.length < MIN_PURPOSES || value.length > MAX_PURPOSES) return `must list ${MIN_PURPOSES} to ${MAX_PURPOSES} phrases, not ${value.length}`;
    for (const [index, phrase] of value.entries()) {
        const position = `phrase ${index + 1}`;
        if (typeof phrase !== 'string') return `${position} is not a string`;
        if (phrase.trim() === '') return `${position} is empty`;
        if (/[\r\n]/.test(phrase)) return `${position} is not on one line`;
        if (phrase.length > MAX_PURPOSE_LENGTH) return `${position} is longer than ${MAX_PURPOSE_LENGTH} characters`;
    }
    return undefined;
}

/** A purpose phrase as the duplicate check compares it: lowercased, trimmed, inner spaces collapsed */
export function normalizePurpose(phrase: string): string {
    return phrase.trim().toLowerCase().replace(/\s+/g, ' ');
}
