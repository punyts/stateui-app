/**
 * Words that carry no need on their own. They are dropped from needs and documents alike, so "pick a date" does not
 * match every summary that starts with "A"
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'for',
    'from',
    'i',
    'in',
    'into',
    'is',
    'it',
    'its',
    'me',
    'my',
    'of',
    'on',
    'or',
    'so',
    'that',
    'the',
    'their',
    'them',
    'this',
    'to',
    'with',
    'you',
    'your'
]);

const MIN_STEM = 3;

/** Removes `suffix` when at least three letters remain; `undefined` when the suffix does not apply */
function cut(word: string, suffix: string, replacement = ''): string | undefined {
    if (!word.endsWith(suffix)) return undefined;
    const stem = word.slice(0, word.length - suffix.length) + replacement;
    return stem.length >= MIN_STEM ? stem : word;
}

/**
 * The light stem, the same for documents and needs. The first rule whose suffix the word has decides, in this order:
 * `ies` becomes `y`; otherwise `ing`, `ed`, `es` (only after `s`, `x`, `z`, `ch` or `sh`) or `s` (not after `ss`) is
 * removed. Nothing is removed when fewer than three letters would remain
 */
export function stem(word: string): string {
    const ies = cut(word, 'ies', 'y');
    if (ies !== undefined) return ies;
    const ing = cut(word, 'ing');
    if (ing !== undefined) return ing;
    const ed = cut(word, 'ed');
    if (ed !== undefined) return ed;
    if (/(?:s|x|z|ch|sh)es$/.test(word)) return cut(word, 'es') ?? word;
    if (word.endsWith('s') && !word.endsWith('ss')) return cut(word, 's') ?? word;
    return word;
}

/** Splits camelCase and every run of non-letters, lowercases, without stemming or dropping stop words */
export function words(text: string): string[] {
    return text
        .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
        .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
        .toLowerCase()
        .split(/[^\p{L}]+/u)
        .filter((word) => word !== '');
}

/** The search terms of a text: its words, stop words dropped, each stemmed (`dateRangeField` gives date, range, field) */
export function tokenize(text: string): string[] {
    return words(text)
        .filter((word) => !STOP_WORDS.has(word))
        .map(stem);
}
