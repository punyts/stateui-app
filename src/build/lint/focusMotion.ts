import type { Declaration } from './mask.js';

/** One offence the lint found: where it starts, the text to quote and why it is rejected */
export interface Finding {
    offset: number;
    token: string;
    reason: string;
}

const OUTLINE_REASON = 'an outline must not be removed; the shared sheet draws focus from the focus tokens';
const DURATION_REASON = 'durations must come from a motion token (var(--ui-motion-duration-*))';

const ZERO_LENGTH = /^[+-]?0*\.?0+(?:[a-z%]+)?$/i;
const LITERAL_DURATION = /(?<![\w.-])[+-]?(?:\d+\.?\d*|\.\d+)(?:ms|s)(?![\w-])/gi;
const TIMING_PROPERTIES = new Set([
    'transition',
    'transition-duration',
    'transition-delay',
    'animation',
    'animation-duration',
    'animation-delay'
]);

/** Replaces every parenthesised group by `()`, innermost first, so a `var()` fallback is not read as a value */
function withoutGroups(value: string): string {
    let text = value;
    for (let previous = ''; previous !== text; ) {
        previous = text;
        text = text.replace(/\([^()]*\)/g, '()');
    }
    return text;
}

/** True when a declaration of `outline` or `outline-width` removes the outline: `none` or a zero width */
function removesOutline(property: string, value: string): boolean {
    const words = withoutGroups(value.replace(/!important/i, ''))
        .trim()
        .split(/\s+/)
        .filter((word) => word !== '');
    if (property === 'outline') return words.some((word) => word.toLowerCase() === 'none' || ZERO_LENGTH.test(word));
    if (property === 'outline-width') return words.some((word) => ZERO_LENGTH.test(word));
    return false;
}

/**
 * The focus and motion rules: no `outline: none`, `outline: 0` or `outline-width: 0` (also `outline-width: 0px`), and no
 * literal `ms` or `s` duration in `transition` or `animation` declarations (including their `-duration` and `-delay`
 * longhands). Works on masked CSS, so comments and strings never match
 */
export function focusMotionFindings(masked: string, declarations: readonly Declaration[]): Finding[] {
    const found: Finding[] = [];
    for (const declaration of declarations) {
        const value = masked.slice(declaration.valueStart, declaration.end);
        const propertyOffset = masked.lastIndexOf(declaration.property, declaration.valueStart - 1);
        if (removesOutline(declaration.property, value)) {
            found.push({
                offset: propertyOffset,
                token: `${declaration.property}: ${value.replace(/\s+/g, ' ').trim()}`,
                reason: OUTLINE_REASON
            });
        }
        if (TIMING_PROPERTIES.has(declaration.property)) {
            for (const match of value.matchAll(LITERAL_DURATION)) {
                found.push({ offset: declaration.valueStart + (match.index ?? 0), token: match[0], reason: DURATION_REASON });
            }
        }
    }
    return found;
}
