import { DEFAULT_LEAVES } from './defaults.js';
import { parseValue } from './references.js';
import type { TokenType } from './types.js';

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)`;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTION_COLOR = new RegExp(
    String.raw`^(?:rgba?|hsla?)\(\s*${NUMBER}(?:deg|%)?(?:\s*[,\s/]\s*${NUMBER}(?:deg|%)?){2,3}\s*\)$`,
    'i'
);
const DIMENSION = new RegExp(`^${NUMBER}(?:px|rem|%)$`);
/** A viewport length, allowed only inside `calc()`, `clamp()`, `min()` and `max()`, so a size can follow the screen */
const VIEWPORT = new RegExp(`^${NUMBER}(?:vw|vh|vmin|vmax)$`);
const MATH_FUNCTION = /^(?:clamp|min|max)\(/;
const PLAIN_NUMBER = new RegExp(`^${NUMBER}$`);
const DURATION = new RegExp(String.raw`^[+]?(?:\d+\.?\d*|\.\d+)(?:ms|s)$`);
const EASING_KEYWORDS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end'];
const CUBIC_BEZIER = new RegExp(
    String.raw`^cubic-bezier\(\s*(${NUMBER})\s*,\s*(${NUMBER})\s*,\s*(${NUMBER})\s*,\s*(${NUMBER})\s*\)$`
);
const FAMILY_ITEM = /^(?:'[^'\\]*'|"[^"\\]*"|[A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)*)$/;
const REFERENCE_MARK = '\u0001';

/** Looks up the type of a referenced token path */
export type TypeLookup = (path: string) => TokenType | undefined;

const DEFAULT_TYPES = new Map(DEFAULT_LEAVES.map((leaf) => [leaf.path, leaf.type]));
const defaultLookup: TypeLookup = (path) => DEFAULT_TYPES.get(path);

/** Splits at top-level separators, ignoring any inside parentheses or quotes */
function splitTopLevel(text: string, separator: (char: string) => boolean): string[] {
    const parts: string[] = [];
    let depth = 0;
    let quote = '';
    let current = '';
    for (const char of text) {
        if (quote) {
            if (char === quote) quote = '';
        } else if (char === "'" || char === '"') quote = char;
        else if (char === '(') depth += 1;
        else if (char === ')') depth -= 1;
        if (!quote && depth === 0 && separator(char)) {
            if (current !== '') parts.push(current);
            current = '';
        } else current += char;
    }
    if (current !== '') parts.push(current);
    return parts;
}

function isColor(text: string): boolean {
    return text === 'transparent' || HEX_COLOR.test(text) || FUNCTION_COLOR.test(text);
}

/** `calc(` of lengths, numbers and reference marks with `+ - * /` and parentheses */
function isCalc(text: string): boolean {
    if (!text.startsWith('calc(') || !text.endsWith(')')) return false;
    const source = text.slice('calc'.length);
    let index = 0;
    const skip = (): void => {
        while (index < source.length && /\s/.test(source[index] as string)) index += 1;
    };
    const operand = (): boolean => {
        skip();
        if (source[index] === '(') {
            index += 1;
            if (!sum()) return false;
            skip();
            if (source[index] !== ')') return false;
            index += 1;
            return true;
        }
        if (source.startsWith('calc(', index)) {
            index += 'calc'.length;
            return operand();
        }
        if (source[index] === REFERENCE_MARK) {
            index += 1;
            return true;
        }
        const match = new RegExp(`^${NUMBER}(?:px|rem|%|vw|vh|vmin|vmax)?`).exec(source.slice(index));
        if (match === null) return false;
        index += match[0].length;
        return true;
    };
    const product = (): boolean => {
        if (!operand()) return false;
        for (;;) {
            const before = index;
            skip();
            const op = source[index];
            if (op !== '*' && op !== '/') {
                index = before;
                return true;
            }
            index += 1;
            if (!operand()) return false;
        }
    };
    function sum(): boolean {
        if (!product()) return false;
        for (;;) {
            const before = index;
            skip();
            const op = source[index];
            if (op !== '+' && op !== '-') {
                index = before;
                return true;
            }
            if (index === before) return false;
            index += 1;
            if (!/\s/.test(source[index] ?? '')) return false;
            if (!product()) return false;
        }
    }
    if (!operand()) return false;
    skip();
    return index === source.length;
}

/** An argument of `clamp()`, `min()` or `max()`: a length, a viewport length, a reference mark or a nested function */
function isMathArgument(text: string): boolean {
    // A math function argument is a calculation of its own, so `4vw + 12px` needs no calc()
    return text === REFERENCE_MARK || VIEWPORT.test(text) || isDimension(text) || isCalc(`calc(${text})`);
}

/** `clamp(a, b, c)`, `min(a, ...)` or `max(a, ...)` of lengths, viewport lengths and `calc()`: a fluid size */
function isMathFunction(text: string): boolean {
    if (!MATH_FUNCTION.test(text) || !text.endsWith(')')) return false;
    // The first parenthesis must close at the very end, so `min(1px) max(2px)` is not one function
    const open = text.indexOf('(');
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
        if (text[index] === '(') depth += 1;
        else if (text[index] === ')') depth -= 1;
        if (depth === 0 && index !== text.length - 1) return false;
    }
    const args = splitTopLevel(text.slice(open + 1, -1), (char) => char === ',').map((arg) => arg.trim());
    const count = text.startsWith('clamp(') ? args.length === 3 : args.length >= 1;
    return count && args.every(isMathArgument);
}

function isDimension(text: string): boolean {
    return text === '0' || DIMENSION.test(text) || isCalc(text) || isMathFunction(text);
}

/** One to four dimensions separated by spaces: the CSS box shorthand (all sides; block and inline; or each side) */
function isInset(text: string): boolean {
    const parts = splitTopLevel(text, (char) => /\s/.test(char));
    return parts.length >= 1 && parts.length <= 4 && parts.every((part) => part === REFERENCE_MARK || isDimension(part));
}

function isShadow(text: string): boolean {
    if (text === 'none') return true;
    const groups = splitTopLevel(text, (char) => char === ',');
    return (
        groups.length > 0 &&
        groups.every((group) => {
            // As in CSS: an optional `inset`, two to four lengths and one color, which comes first or last
            const parts = splitTopLevel(group.trim(), (char) => /\s/.test(char));
            const rest = parts.filter((part) => part !== 'inset');
            if (parts.length - rest.length > 1) return false;
            const colors = rest.filter(isColor);
            const lengths = rest.filter((part) => !isColor(part));
            const color = colors[0];
            return (
                colors.length === 1 &&
                (rest[0] === color || rest[rest.length - 1] === color) &&
                lengths.length >= 2 &&
                lengths.length <= 4 &&
                lengths.every((part) => part === '0' || DIMENSION.test(part))
            );
        })
    );
}

function isEasing(text: string): boolean {
    if (EASING_KEYWORDS.includes(text)) return true;
    const match = CUBIC_BEZIER.exec(text);
    if (match === null) return false;
    const x1 = Number(match[1]);
    const x2 = Number(match[3]);
    return x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1;
}

function isFontWeight(text: string): boolean {
    if (text === 'normal' || text === 'bold') return true;
    const weight = Number(text);
    return /^\d{3}$/.test(text) && weight >= 100 && weight <= 900;
}

function matchesType(type: TokenType, text: string): boolean {
    switch (type) {
        case 'color':
            return isColor(text);
        case 'dimension':
            return isDimension(text);
        case 'inset':
            return isInset(text);
        case 'number':
            return PLAIN_NUMBER.test(text);
        case 'duration':
            return DURATION.test(text);
        case 'easing':
            return isEasing(text);
        case 'shadow':
            return isShadow(text);
        case 'fontFamily': {
            const items = splitTopLevel(text, (char) => char === ',').map((item) => item.trim());
            return items.length > 0 && items.every((item) => FAMILY_ITEM.test(item));
        }
        case 'fontWeight':
            return isFontWeight(text);
    }
}

/** True when the value holds anything that could escape the declaration: `url(`, `@`, `;`, `expression`, a stray brace */
export function hasInjection(text: string): boolean {
    const bare = parseValue(text)
        .filter((part) => part.kind === 'text')
        .map((part) => (part.kind === 'text' ? part.text : ''))
        .join(' ');
    return /url\(|expression/i.test(bare) || /[@;{}]/.test(bare);
}

/**
 * True when the value fits the type. A value that is one reference passes when the referenced token has the same
 * type (looked up with `typeOf`, which defaults to the default tree); a dimension reference also fits an `inset`. A
 * reference inside a larger value is allowed only in a `dimension` `calc()`, `clamp()`, `min()` or `max()`, and as a
 * dimension part of an `inset`. A value with `url(`, `@`, `;`, `expression` or a brace that is not a reference never
 * passes
 */
export function validateTokenValue(type: TokenType, text: string, typeOf: TypeLookup = defaultLookup): boolean {
    if (hasInjection(text)) return false;
    const trimmed = text.trim();
    if (trimmed === '') return false;
    const parts = parseValue(trimmed);
    const only = parts[0];
    if (parts.length === 1 && only !== undefined && only.kind === 'ref') {
        const target = typeOf(only.path);
        return target === type || (type === 'inset' && target === 'dimension');
    }
    if (parts.some((part) => part.kind === 'ref')) {
        const marked = parts.map((part) => (part.kind === 'ref' ? REFERENCE_MARK : part.text)).join('');
        if (type === 'inset') {
            return parts.every((part) => part.kind !== 'ref' || typeOf(part.path) === 'dimension') && isInset(marked);
        }
        if (type !== 'dimension' || !(trimmed.startsWith('calc(') || MATH_FUNCTION.test(trimmed))) return false;
        return isCalc(marked) || isMathFunction(marked);
    }
    return matchesType(type, trimmed);
}
