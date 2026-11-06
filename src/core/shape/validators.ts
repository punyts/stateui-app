import { parsePathData } from '../geometry/pathData.js';
import { isColor } from '../theme/value.js';
import type { JsonValue } from '../types.js';
import {
    MAX_COLOR_LENGTH,
    MAX_PATH_COMMANDS,
    MAX_PATH_DATA_LENGTH,
    MAX_PATTERN_INPUT,
    MAX_PATTERN_LENGTH,
    MAX_POINTS,
    OBJECT_FIELD_TYPES
} from './types.js';
import type { Bounds, FieldValidators, FileRefOptions, ObjectField, ObjectFieldType, PropertyType, ValidatorOptions } from './types.js';

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

/** True when a group that holds a quantifier is itself quantified, as in `(a+)+` or `(a*){2,}`: a shape that backtracks without end */
function hasNestedQuantifier(pattern: string): boolean {
    const groups: boolean[] = [];
    let inClass = false;
    let justClosed = false;
    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i] as string;
        const afterGroup = justClosed;
        justClosed = false;
        if (char === '\\') {
            i++;
            continue;
        }
        if (inClass) {
            if (char === ']') inClass = false;
            continue;
        }
        if (char === '[') {
            inClass = true;
        } else if (char === '(') {
            groups.push(false);
        } else if (char === ')') {
            const holdsQuantifier = groups.pop() === true;
            justClosed = holdsQuantifier;
            if (holdsQuantifier && groups.length > 0) groups[groups.length - 1] = true;
        } else if (char === '+' || char === '*' || (char === '{' && /^\{\d+,\d*\}/.test(pattern.slice(i)))) {
            if (afterGroup) return true;
            if (groups.length > 0) groups[groups.length - 1] = true;
        }
    }
    return false;
}

/** True when a regular expression is within `max` characters, compiles and has no nested quantifier */
function isSafeExpression(value: string, max: number): boolean {
    if (value.length > max) return false;
    try {
        new RegExp(value, 'u');
    } catch {
        return false;
    }
    return !hasNestedQuantifier(value);
}

function sameJson(a: JsonValue, b: JsonValue): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** A token reference of two or more dotted steps, as the theme writes it (`{color.accent.base}`); only the syntax is checked */
const TOKEN_REFERENCE = /^\{[a-z0-9]+(?:\.[a-z0-9]+)+\}$/;

/** A paint name: the key of a gradient in a drawing's `paints` */
const PAINT_NAME = /^[a-z][A-Za-z0-9_-]*$/;

/** A UUID in its canonical form, any version */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A media type such as `image/png` or `image/svg+xml` */
const MEDIA_TYPE = /^[a-z]+\/[a-z0-9][a-z0-9.+-]*$/;

/** The head of a `data:` URL: its media type, the optional parameters and `;base64` */
const DATA_URL = /^data:([a-z]+\/[a-z0-9][a-z0-9.+-]*)((?:;[a-z0-9-]+=[a-z0-9.+-]+)*)(;base64)?,/i;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The keys of a file reference */
const FILE_REF_KEYS = ['id', 'name', 'size', 'type'];

/** The validators a field of `fields` may carry */
const FIELD_VALIDATOR_NAMES: readonly (keyof FieldValidators)[] = ['color', 'pathData', 'points', 'vector', 'fields', 'fileRef', 'range', 'oneOf'];

/** The keys of one field of `fields` */
const OBJECT_FIELD_KEYS = ['type', 'values', 'required', 'validators'];

/** The JSON kind of a value, named as the property types are */
function kindOf(value: JsonValue): PropertyType | 'null' {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value as 'string' | 'number' | 'boolean' | 'object';
}

function isFiniteNumber(value: JsonValue | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function parseTrue(options: JsonValue): true | undefined {
    return options === true ? true : undefined;
}

function isColorValue(value: string): boolean {
    if (value.length > MAX_COLOR_LENGTH) return false;
    return TOKEN_REFERENCE.test(value) || PAINT_NAME.test(value) || isColor(value);
}

function isPathData(value: string): boolean {
    if (value.length > MAX_PATH_DATA_LENGTH || value.trim() === '') return false;
    const result = parsePathData(value);
    return result.ok && result.commands.length <= MAX_PATH_COMMANDS;
}

function isPoints(value: JsonValue[]): boolean {
    if (value.length > MAX_POINTS) return false;
    return value.every((point) => Array.isArray(point) && point.length === 2 && isFiniteNumber(point[0]) && isFiniteNumber(point[1]));
}

function parseFileRef(options: JsonValue): FileRefOptions | undefined {
    if (!isObject(options) || Object.keys(options).some((key) => key !== 'types' && key !== 'dataUrl')) return undefined;
    const { types, dataUrl } = options;
    if (!Array.isArray(types) || types.length === 0) return undefined;
    if (!types.every((type): type is string => typeof type === 'string' && MEDIA_TYPE.test(type))) return undefined;
    if (new Set(types).size !== types.length) return undefined;
    if (dataUrl !== undefined && typeof dataUrl !== 'boolean') return undefined;
    // A data URL is only ever an image, so `dataUrl` needs an image type to accept
    if (dataUrl === true && !types.some((type) => type.startsWith('image/'))) return undefined;
    return dataUrl === undefined ? { types } : { types, dataUrl };
}

/** True when the value is a `data:` URL of an image type in `types`, with a well-formed base64 body when it says `;base64` */
function isImageDataUrl(value: string, types: readonly string[]): boolean {
    const head = DATA_URL.exec(value);
    if (head === null) return false;
    const type = (head[1] as string).toLowerCase();
    if (!type.startsWith('image/') || !types.includes(type)) return false;
    return head[3] === undefined || BASE64.test(value.slice(head[0].length));
}

function isFileRef(value: JsonValue, options: FileRefOptions): boolean {
    if (typeof value === 'string') return options.dataUrl === true && isImageDataUrl(value, options.types);
    if (!isObject(value)) return true;
    if (Object.keys(value).some((key) => !FILE_REF_KEYS.includes(key))) return false;
    const { id, name, size, type } = value;
    return (
        typeof id === 'string' &&
        UUID.test(id) &&
        typeof name === 'string' &&
        typeof size === 'number' &&
        Number.isInteger(size) &&
        size >= 0 &&
        typeof type === 'string' &&
        options.types.includes(type)
    );
}

function isObjectFieldType(value: JsonValue | undefined): value is ObjectFieldType {
    return (OBJECT_FIELD_TYPES as readonly unknown[]).includes(value);
}

/** Reads the validators of one field: only the field validators, each well formed and applying to the field's type */
function parseFieldValidators(options: JsonValue, type: ObjectFieldType): FieldValidators | undefined {
    if (!isObject(options)) return undefined;
    const parsed: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(options)) {
        if (!(FIELD_VALIDATOR_NAMES as readonly string[]).includes(name)) return undefined;
        const rule = VALIDATORS[name as keyof FieldValidators] as ValidatorRule<ValidatorName>;
        const result = rule.parse(value);
        if (result === undefined || !rule.applies(type)) return undefined;
        parsed[name] = result;
    }
    return parsed as FieldValidators;
}

function parseObjectField(options: JsonValue): ObjectField | undefined {
    if (!isObject(options) || Object.keys(options).some((key) => !OBJECT_FIELD_KEYS.includes(key))) return undefined;
    const { type, values, required, validators } = options;
    if (!isObjectFieldType(type)) return undefined;
    const field: ObjectField = { type };
    if (values !== undefined) {
        if (!Array.isArray(values) || values.length === 0 || !values.every((value) => fitsFieldType(type, value))) return undefined;
        field.values = values;
    }
    if (required !== undefined) {
        if (typeof required !== 'boolean') return undefined;
        field.required = required;
    }
    if (validators !== undefined) {
        const parsed = parseFieldValidators(validators, type);
        if (parsed === undefined) return undefined;
        field.validators = parsed;
    }
    return field;
}

function parseFields(options: JsonValue): Record<string, ObjectField> | undefined {
    if (!isObject(options) || Object.keys(options).length === 0) return undefined;
    const fields: Record<string, ObjectField> = {};
    for (const [name, value] of Object.entries(options)) {
        if (name === '') return undefined;
        const field = parseObjectField(value);
        if (field === undefined) return undefined;
        fields[name] = field;
    }
    return fields;
}

function fitsFieldType(type: ObjectFieldType, value: JsonValue): boolean {
    if (type === 'number') return isFiniteNumber(value);
    if (type === 'object') return isObject(value);
    return kindOf(value) === type;
}

function fitsField(field: ObjectField, value: JsonValue): boolean {
    if (!fitsFieldType(field.type, value)) return false;
    if (field.values !== undefined && !field.values.some((allowed) => sameJson(allowed, value))) return false;
    return field.validators === undefined || passesValidators(value, field.validators);
}

function hasFields(value: JsonValue, fields: Record<string, ObjectField>): boolean {
    if (!isObject(value)) return true;
    if (Object.keys(value).some((key) => !Object.hasOwn(fields, key))) return false;
    return Object.entries(fields).every(([name, field]) => {
        const entry = Object.hasOwn(value, name) ? value[name] : undefined;
        return entry === undefined ? field.required !== true : fitsField(field, entry);
    });
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
    regex: {
        parse: (options) =>
            typeof options === 'number' && Number.isInteger(options) && options >= 1 && options <= MAX_PATTERN_LENGTH ? options : undefined,
        applies: (type) => type === 'string',
        check: (value, options) => typeof value === 'string' && isSafeExpression(value, options)
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
    },
    // The graphics validators below pass a value of a type they do not apply to: the property's type check has
    // already refused it unless the property lists several types (`drawImage.src` is a string or an object)
    color: {
        parse: parseTrue,
        applies: (type) => type === 'string',
        check: (value) => typeof value !== 'string' || isColorValue(value)
    },
    pathData: {
        parse: parseTrue,
        applies: (type) => type === 'string',
        check: (value) => typeof value !== 'string' || isPathData(value)
    },
    points: {
        parse: parseTrue,
        applies: (type) => type === 'array',
        check: (value) => !Array.isArray(value) || isPoints(value)
    },
    vector: {
        parse: (options) => (options === 2 || options === 3 ? options : undefined),
        applies: (type) => type === 'array',
        check: (value, options) => !Array.isArray(value) || (value.length === options && value.every(isFiniteNumber))
    },
    fields: {
        parse: parseFields,
        applies: (type) => type === 'object',
        check: (value, options) => hasFields(value, options)
    },
    fileRef: {
        parse: parseFileRef,
        applies: (type) => type === 'string' || type === 'object',
        check: (value, options) => isFileRef(value, options)
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
