import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { PREFIXES, RESERVED_KEYS } from '../types.js';
import type { JsonValue } from '../types.js';
import { fitsProperty } from './fit.js';
import { MAX_PATTERN_LENGTH, MAX_SUMMARY_LENGTH, PROPERTY_TYPES } from './types.js';
import type { PropertyShape, PropertyType, Shape } from './types.js';
import { VALIDATORS, isValidatorName } from './validators.js';

/** What the parser hands every rule: the file being read, the error list and where in the file the rule runs */
export interface RuleContext {
    file: string;
    errors: BuildError[];
    /** Dotted location of the object the key sits in, empty at the top; `properties.size` inside a property */
    where: string;
}

type KeyType = 'string' | 'boolean' | 'object' | 'array' | 'any';

/**
 * One key of a shape file: its name, the JSON type the parser checks before calling the rule, and the rule.
 * The rule reads the value into the target and reports what is wrong with it. A required key that is absent
 * reports `missing` (default: `SUI-BUILD-SHAPE`). Later stories add keys by adding rows to the tables below
 */
export interface KeyRule<Target> {
    name: string;
    type: KeyType;
    required: boolean;
    missing?: (context: RuleContext, key: string) => BuildError;
    rule: (value: JsonValue, target: Target, context: RuleContext) => void;
}

function kindOf(value: JsonValue): KeyType | 'null' | 'number' {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value as KeyType | 'number';
}

function locate(context: RuleContext, key: string): string {
    return context.where === '' ? key : `${context.where}.${key}`;
}

function invalid(context: RuleContext, key: string): BuildError {
    return buildError('SUI-BUILD-SHAPE', { file: context.file, name: locate(context, key) });
}

/** Applies a key table to a parsed JSON object: unknown keys, missing required keys, JSON types, then the rules */
export function applyKeys<Target>(
    table: readonly KeyRule<Target>[],
    input: { [key: string]: JsonValue },
    target: Target,
    context: RuleContext
): void {
    const known = new Set(table.map((entry) => entry.name));
    for (const key of Object.keys(input)) {
        if (!known.has(key)) {
            context.errors.push(buildError('SUI-BUILD-KEY', { file: context.file, key, path: context.where === '' ? '$' : context.where }));
        }
    }
    for (const entry of table) {
        const value = input[entry.name];
        if (value === undefined) {
            if (entry.required) {
                context.errors.push(entry.missing ? entry.missing(context, entry.name) : invalid(context, entry.name));
            }
            continue;
        }
        if (entry.type !== 'any' && kindOf(value) !== entry.type) {
            context.errors.push(invalid(context, entry.name));
            continue;
        }
        entry.rule(value, target, context);
    }
}

function asObject(value: JsonValue): { [key: string]: JsonValue } {
    return value as { [key: string]: JsonValue };
}

const NAME = /^_?[a-zA-Z][a-zA-Z0-9]*$/;
const EVENT_NAME = /^[a-z][a-zA-Z0-9]*$/;
const SHAPE_RESERVED: readonly string[] = [
    RESERVED_KEYS.component,
    RESERVED_KEYS.layout,
    RESERVED_KEYS.placement,
    RESERVED_KEYS.theme,
    RESERVED_KEYS.on
];

function isAllowedName(name: string): boolean {
    if (name.startsWith(PREFIXES.link) || name.startsWith('$') || name.startsWith(PREFIXES.reserved)) return false;
    return NAME.test(name) && !SHAPE_RESERVED.includes(name);
}

/** A property while it is being read: the type may still be unset */
interface PropertyDraft extends PropertyShape {
    typeSet: boolean;
}

/** The keys of one property */
export const PROPERTY_KEYS: readonly KeyRule<PropertyDraft>[] = [
    {
        name: 'type',
        type: 'string',
        required: true,
        rule(value, draft, context) {
            if (!PROPERTY_TYPES.includes(value as PropertyType)) {
                context.errors.push(invalid(context, 'type'));
                return;
            }
            draft.type = value as PropertyType;
            draft.typeSet = true;
        }
    },
    {
        name: 'default',
        type: 'any',
        required: false,
        rule(value, draft) {
            draft.default = value;
        }
    },
    {
        name: 'required',
        type: 'boolean',
        required: false,
        rule(value, draft) {
            draft.required = value === true;
        }
    },
    {
        name: 'kind',
        type: 'string',
        required: false,
        rule(value, draft, context) {
            if (value !== 'content') {
                context.errors.push(invalid(context, 'kind'));
                return;
            }
            draft.kind = 'content';
        }
    },
    {
        name: 'values',
        type: 'array',
        required: false,
        rule(value, draft, context) {
            if ((value as JsonValue[]).length === 0) {
                context.errors.push(invalid(context, 'values'));
                return;
            }
            draft.values = value as JsonValue[];
        }
    },
    {
        name: 'validators',
        type: 'object',
        required: false,
        rule(value, draft, context) {
            const property = context.where.split('.').pop() as string;
            for (const [name, options] of Object.entries(asObject(value))) {
                if (!isValidatorName(name)) {
                    context.errors.push(buildError('SUI-BUILD-VALIDATOR', { file: context.file, name, key: property }));
                    continue;
                }
                const rule = VALIDATORS[name];
                const parsed = rule.parse(options);
                if (parsed === undefined) {
                    if (name === 'pattern' && typeof options === 'string') {
                        context.errors.push(
                            buildError('SUI-BUILD-PATTERN', { file: context.file, name: property, limit: MAX_PATTERN_LENGTH })
                        );
                    } else {
                        context.errors.push(invalid(context, `validators.${name}`));
                    }
                    continue;
                }
                if (draft.typeSet && !rule.applies(draft.type)) {
                    context.errors.push(invalid(context, `validators.${name}`));
                    continue;
                }
                (draft.validators as Record<string, unknown>)[name] = parsed;
            }
        }
    }
];

function readProperty(name: string, input: JsonValue, context: RuleContext): PropertyShape | undefined {
    if (!isAllowedName(name)) {
        context.errors.push(buildError('SUI-BUILD-NAME', { file: context.file, name }));
        return undefined;
    }
    const where = locate(context, name);
    if (kindOf(input) !== 'object') {
        context.errors.push(buildError('SUI-BUILD-SHAPE', { file: context.file, name: where }));
        return undefined;
    }
    const before = context.errors.length;
    const draft: PropertyDraft = { type: 'any', required: false, validators: {}, typeSet: false };
    applyKeys(PROPERTY_KEYS, asObject(input), draft, { ...context, where });

    if ((name.startsWith(PREFIXES.content) ? 'content' : undefined) !== draft.kind) {
        context.errors.push(buildError('SUI-BUILD-KIND', { file: context.file, name }));
    }
    if (context.errors.length > before) return undefined;

    const { typeSet: _typeSet, ...property } = draft;
    if (property.values?.some((value) => !fitsValueType(property, value))) {
        context.errors.push(buildError('SUI-BUILD-SHAPE', { file: context.file, name: `${where}.values` }));
        return undefined;
    }
    if (property.default !== undefined && !fitsProperty(property, property.default)) {
        context.errors.push(buildError('SUI-BUILD-DEFAULT', { file: context.file, name }));
        return undefined;
    }
    return property;
}

function fitsValueType(property: PropertyShape, value: JsonValue): boolean {
    return fitsProperty({ type: property.type, required: false, validators: {} }, value);
}

function readNames(value: JsonValue, context: RuleContext, key: string): string[] {
    const names = value as JsonValue[];
    const valid = names.every((name) => typeof name === 'string' && EVENT_NAME.test(name)) && new Set(names).size === names.length;
    if (!valid) {
        context.errors.push(invalid(context, key));
        return [];
    }
    return names as string[];
}

/** The top-level keys of a shape file. `summary` is required; the rest are optional */
export const SHAPE_KEYS: readonly KeyRule<Shape>[] = [
    {
        name: 'summary',
        type: 'any',
        required: true,
        missing: (context) => buildError('SUI-BUILD-SUMMARY', { file: context.file, limit: MAX_SUMMARY_LENGTH }),
        rule(value, shape, context) {
            const ok = typeof value === 'string' && value.trim() !== '' && value.length <= MAX_SUMMARY_LENGTH && !/[\r\n]/.test(value);
            if (!ok) {
                context.errors.push(buildError('SUI-BUILD-SUMMARY', { file: context.file, limit: MAX_SUMMARY_LENGTH }));
                return;
            }
            shape.summary = value;
        }
    },
    {
        name: 'properties',
        type: 'object',
        required: false,
        rule(value, shape, context) {
            for (const [name, input] of Object.entries(asObject(value))) {
                const property = readProperty(name, input, { ...context, where: 'properties' });
                if (property) shape.properties[name] = property;
            }
        }
    },
    {
        name: 'events',
        type: 'array',
        required: false,
        rule(value, shape, context) {
            shape.events = readNames(value, context, 'events');
        }
    },
    {
        name: 'commands',
        type: 'array',
        required: false,
        rule(value, shape, context) {
            shape.commands = readNames(value, context, 'commands');
        }
    },
    {
        name: 'layout',
        type: 'boolean',
        required: false,
        rule(value, shape) {
            shape.layout = value === true;
        }
    }
];
