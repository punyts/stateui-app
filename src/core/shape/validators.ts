import type { JsonValue } from '../types.js';
import { MAX_PATTERN_INPUT, MAX_PATTERN_LENGTH } from './types.js';
import type { Bounds, PropertyType, ValidatorOptions } from './types.js';

type ValidatorName = keyof ValidatorOptions;

/** A named validator: how to read its options, which types it applies to and how to check a value */
interface ValidatorRule<K extends ValidatorName> {
    /** Returns the options when they are well formed, otherwise undefined */
    parse(options: JsonValue): ValidatorOptions[K] | undefined;
    applies(type: PropertyType): boolean;
    check(value: JsonValue, options: NonNullable<ValidatorOptions[K]>): boolean;
}

function isObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBounds(options: JsonValue, integer: boolean): Bounds | undefined {
    if (!isObject(options)) return undefined;
    const keys = Object.keys(options);
    if (keys.length === 0 || keys.some((key) => key !== 'min' && key !== 'max')) return undefined;
    const bounds: Bounds = {};
    for (const key of ['min', 'max'] as const) {
        const value = options[key];
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
        if (integer && (!Number.isInteger(value) || value < 0)) return undefined;
        bounds[key] = value;
    }
    if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max) return undefined;
    return bounds;
}

function inBounds(size: number, bounds: Bounds): boolean {
    return (bounds.min === undefined || size >= bounds.min) && (bounds.max === undefined || size <= bounds.max);
}

function compile(pattern: string): RegExp | undefined {
    if (pattern.length > MAX_PATTERN_LENGTH) return undefined;
    try {
        return new RegExp(pattern, 'u');
    } catch {
        return undefined;
    }
}

function sameJson(a: JsonValue, b: JsonValue): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** The closed set of validators. Adding one is a change here, never in a shape file */
export const VALIDATORS: { [K in ValidatorName]: ValidatorRule<K> } = {
    oneOf: {
        parse: (options) => (Array.isArray(options) && options.length > 0 ? options : undefined),
        applies: () => true,
        check: (value, options) => options.some((option) => sameJson(option, value))
    },
    pattern: {
        parse: (options) => (typeof options === 'string' && compile(options) !== undefined ? options : undefined),
        applies: (type) => type === 'string' || type === 'url',
        check: (value, options) => {
            if (typeof value !== 'string' || value.length > MAX_PATTERN_INPUT) return false;
            const expression = compile(options);
            return expression !== undefined && expression.test(value);
        }
    },
    range: {
        parse: (options) => parseBounds(options, false),
        applies: (type) => type === 'number' || type === 'integer',
        check: (value, options) => typeof value === 'number' && inBounds(value, options)
    },
    length: {
        parse: (options) => parseBounds(options, true),
        applies: (type) => type === 'string' || type === 'array',
        check: (value, options) => (typeof value === 'string' || Array.isArray(value)) && inBounds(value.length, options)
    }
};

const VALIDATOR_NAMES = Object.keys(VALIDATORS) as ValidatorName[];

/** True when `name` is one of the closed validator names */
export function isValidatorName(name: string): name is ValidatorName {
    return Object.hasOwn(VALIDATORS, name);
}

/** True when the pattern is within the length limit and compiles */
export function isValidPattern(pattern: string): boolean {
    return compile(pattern) !== undefined;
}

/** Runs every validator set on a property; true when all pass */
export function passesValidators(value: JsonValue, validators: ValidatorOptions): boolean {
    for (const name of VALIDATOR_NAMES) {
        const options = validators[name];
        if (options === undefined) continue;
        const rule = VALIDATORS[name] as ValidatorRule<ValidatorName>;
        if (!rule.check(value, options as never)) return false;
    }
    return true;
}
