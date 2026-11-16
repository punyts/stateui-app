/** A part name: lower-case letters, digits and dashes, starting with a letter, at most 63 characters */
const PART_NAME = /^[a-z][a-z0-9-]{0,62}$/;

const MAX_NAME_LENGTH = 63;

/** The letter put before a slug that would start with a digit */
const DIGIT_PREFIX = 'n';

/** A slug for a name that has no letter or digit at all */
const EMPTY_SLUG = 'part';

/**
 * True when `value` is a valid part name. The pattern already starts with a letter, so no part name is integer-like;
 * the check is kept explicit because integer-like keys would be reordered
 */
export function isPartName(value: unknown): value is string {
    return typeof value === 'string' && PART_NAME.test(value) && !/^\d+$/.test(value);
}

/**
 * A part name for `raw`: lower-case, every other character to `-` (runs collapsed, no dash at either end), a leading
 * digit prefixed with a letter, at most 63 characters, and a numeric suffix (`-2`, `-3`, …) while the name is in `taken`
 */
export function slugifyName(raw: string, taken: Iterable<string> = []): string {
    const used = new Set(taken);
    let base = raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (base === '') base = EMPTY_SLUG;
    if (/^\d/.test(base)) base = `${DIGIT_PREFIX}${base}`;
    base = trim(base, MAX_NAME_LENGTH);
    if (!used.has(base)) return base;
    for (let suffix = 2; ; suffix++) {
        const tail = `-${suffix}`;
        const candidate = `${trim(base, MAX_NAME_LENGTH - tail.length)}${tail}`;
        if (!used.has(candidate)) return candidate;
    }
}

/** Cuts a slug to a length without leaving a dash at its end */
function trim(slug: string, length: number): string {
    return slug.slice(0, length).replace(/-+$/, '');
}
