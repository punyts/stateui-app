import { HIDDEN, closedList, isArticulationName, isSharedName } from '../articulation/index.js';
import type { SharedName } from '../articulation/index.js';
import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { inferComponentDefault } from '../theme/componentTokens.js';
import { tokenLayer } from '../theme/defaults.js';
import { PREFIXES, RESERVED_KEYS } from '../types.js';
import type { JsonValue } from '../types.js';
import { fitsProperty, typesOf } from './fit.js';
import { MAX_PATTERN_LENGTH, MAX_SUMMARY_LENGTH, PROPERTY_TYPES } from './types.js';
import type { PropertyShape, PropertyType, Shape } from './types.js';
import type { ComponentToken } from '../theme/types.js';
import { VALIDATORS, isValidatorName } from './validators.js';
import { COMPONENT_CATEGORIES, MAX_PURPOSE_LENGTH, checkPurposes, isComponentCategory } from './categories.js';

/** `SUI-BUILD-CATEGORY` for a file: a missing category, or one not in the list */
export function categoryError(file: string): BuildError {
    return buildError('SUI-BUILD-CATEGORY', { file, name: COMPONENT_CATEGORIES.join(', ') });
}

/** `SUI-BUILD-PURPOSES` for a file, with what is wrong */
export function purposesError(file: string, reason: string): BuildError {
    return buildError('SUI-BUILD-PURPOSES', { file, name: reason, limit: MAX_PURPOSE_LENGTH });
}

/** What the parser hands every rule: the file being read, the error list and where in the file the rule runs */
export interface RuleContext {
    file: string;
    errors: BuildError[];
    /** Dotted location of the object the key sits in, empty at the top; `properties.size` inside a property */
    where: string;
    /** True inside the `items` of a map: runtime and reflect do not apply there */
    nested?: boolean;
    /** The camel-cased component name the shape file belongs to; the default token group */
    component?: string;
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

/** A non-empty list of distinct component names (lower camel case), or undefined when the value is not one */
function readComponentNames(value: JsonValue): string[] | undefined {
    const list = value as JsonValue[];
    const valid =
        list.length > 0 &&
        list.every((entry) => typeof entry === 'string' && EVENT_NAME.test(entry)) &&
        new Set(list).size === list.length;
    return valid ? (list as string[]) : undefined;
}

/** The keys of one property */
export const PROPERTY_KEYS: readonly KeyRule<PropertyDraft>[] = [
    {
        name: 'type',
        type: 'any',
        required: true,
        rule(value, draft, context) {
            const list = Array.isArray(value) ? value : [value];
            const valid =
                list.length > 0 &&
                list.every((entry) => PROPERTY_TYPES.includes(entry as PropertyType)) &&
                new Set(list).size === list.length;
            if (!valid) {
                context.errors.push(invalid(context, 'type'));
                return;
            }
            draft.type = list.length === 1 ? (list[0] as PropertyType) : (list as PropertyType[]);
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
                if (draft.typeSet && !typesOf(draft).some((type) => rule.applies(type))) {
                    context.errors.push(invalid(context, `validators.${name}`));
                    continue;
                }
                (draft.validators as Record<string, unknown>)[name] = parsed;
            }
        }
    },
    {
        name: 'items',
        type: 'any',
        required: false,
        rule(value, draft, context) {
            if (value === 'string') {
                draft.items = 'string';
                return;
            }
            if (kindOf(value) !== 'object' || Object.keys(asObject(value)).length === 0) {
                context.errors.push(invalid(context, 'items'));
                // Marks the key as present so checkCombination does not report it missing as well
                draft.items = {};
                return;
            }
            draft.items = readProperties(asObject(value), { ...context, where: locate(context, 'items'), nested: true });
        }
    },
    {
        name: 'requiredWhen',
        type: 'object',
        required: false,
        rule(value, draft, context) {
            const input = asObject(value);
            const keys = Object.keys(input).sort().join(',');
            const condition = input.property;
            const valid = typeof condition === 'string' && (keys === 'equals,property' || keys === 'notEquals,property');
            if (!valid) {
                context.errors.push(invalid(context, 'requiredWhen'));
                return;
            }
            draft.requiredWhen =
                input.equals !== undefined
                    ? { property: condition, equals: input.equals }
                    : { property: condition, notEquals: input.notEquals as JsonValue };
        }
    },
    {
        name: 'runtime',
        type: 'boolean',
        required: false,
        rule(value, draft) {
            draft.runtime = value === true;
        }
    },
    {
        name: 'reflect',
        type: 'boolean',
        required: false,
        rule(value, draft) {
            draft.reflect = value === true;
        }
    },
    {
        name: 'row',
        type: 'boolean',
        required: false,
        rule(value, draft) {
            draft.row = value === true;
        }
    },
    {
        name: 'exposed',
        type: 'boolean',
        required: false,
        rule(value, draft) {
            draft.exposed = value === true;
        }
    },
    {
        name: 'childComponents',
        type: 'array',
        required: false,
        rule(value, draft, context) {
            const names = readComponentNames(value);
            if (names === undefined) {
                context.errors.push(invalid(context, 'childComponents'));
                return;
            }
            draft.childComponents = names;
        }
    }
];

const NOT_REFLECTED: readonly PropertyType[] = ['node', 'array', 'object', 'map', 'any'];

/** The checks that need the whole property: its type decides whether `items`, `runtime`, `reflect`, `row` and `exposed` fit */
function checkCombination(draft: PropertyDraft, where: string, context: RuleContext): void {
    if (!draft.typeSet) return;
    const types = typesOf(draft);
    const problem = (key: string): void => {
        context.errors.push(buildError('SUI-BUILD-SHAPE', { file: context.file, name: `${where}.${key}` }));
    };
    if (types.includes('map') !== (draft.items !== undefined)) problem('items');
    if (draft.row && !types.includes('node')) problem('row');
    if (draft.childComponents !== undefined && !types.includes('node')) problem('childComponents');
    if (draft.reflect && (context.nested || types.some((type) => NOT_REFLECTED.includes(type)))) problem('reflect');
    if (draft.runtime && (context.nested || draft.default === undefined || draft.required)) problem('runtime');
    if (draft.exposed && !draft.runtime) problem('exposed');
}

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
    const draft: PropertyDraft = {
        type: 'any',
        required: false,
        validators: {},
        runtime: false,
        reflect: false,
        row: false,
        exposed: false,
        typeSet: false
    };
    applyKeys(PROPERTY_KEYS, asObject(input), draft, { ...context, where });
    checkCombination(draft, where, context);

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
    return fitsProperty({ ...property, required: false, validators: {}, values: undefined }, value);
}

/** Reads a table of properties; a `requiredWhen` must name another property of the same table */
function readProperties(input: { [key: string]: JsonValue }, context: RuleContext): Record<string, PropertyShape> {
    const properties: Record<string, PropertyShape> = {};
    for (const [name, value] of Object.entries(input)) {
        const property = readProperty(name, value, context);
        if (property) properties[name] = property;
    }
    for (const [name, property] of Object.entries(properties)) {
        const sibling = property.requiredWhen?.property;
        if (sibling !== undefined && (sibling === name || !Object.hasOwn(properties, sibling))) {
            context.errors.push(
                buildError('SUI-BUILD-SHAPE', { file: context.file, name: `${locate(context, name)}.requiredWhen.property` })
            );
        }
    }
    return properties;
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

/** The keys of one `shared` entry */
const SHARED_ENTRY_KEYS: readonly KeyRule<{ default?: JsonValue }>[] = [
    {
        name: 'default',
        type: 'any',
        required: false,
        rule(value, entry) {
            entry.default = value;
        }
    }
];

/** The property a shared entry expands to: a string with the closed list as its values, written as an attribute */
function sharedProperty(name: SharedName, fallback: JsonValue | undefined): PropertyShape {
    return {
        type: 'string',
        required: false,
        ...(fallback === undefined ? {} : { default: fallback }),
        values: closedList(name),
        validators: {},
        runtime: false,
        reflect: true,
        row: false,
        exposed: false
    };
}

/** Reads `shared`: each entry names one shared property and may set its default; `hidden` is never declared */
function readShared(value: { [key: string]: JsonValue }, shape: Shape, context: RuleContext): void {
    for (const [name, input] of Object.entries(value)) {
        const where = `shared.${name}`;
        if (!isSharedName(name) || kindOf(input) !== 'object') {
            context.errors.push(buildError('SUI-BUILD-SHAPE', { file: context.file, name: where }));
            continue;
        }
        const entry: { default?: JsonValue } = {};
        const before = context.errors.length;
        applyKeys(SHARED_ENTRY_KEYS, asObject(input), entry, { ...context, where });
        if (context.errors.length > before) continue;
        if (entry.default !== undefined && !closedList(name).includes(entry.default as string)) {
            context.errors.push(buildError('SUI-BUILD-DEFAULT', { file: context.file, name }));
            continue;
        }
        // An own property of the same name is reported by `finishShape` and keeps its place
        if (Object.hasOwn(shape.properties, name)) continue;
        shape.shared.push(name);
        shape.properties[name] = sharedProperty(name, entry.default);
    }
}

const TOKEN_SEGMENT = /^[a-z0-9]+$/;
const TOKEN_GROUP = /^[a-z][a-z0-9]*$/;

/** Reads `tokens`: nested objects whose leaves are semantic references; the group is added by `finishShape` */
function readTokens(input: { [key: string]: JsonValue }, shape: Shape, context: RuleContext): void {
    const tokens: ComponentToken[] = [];
    const walk = (node: { [key: string]: JsonValue }, prefix: string[]): void => {
        for (const [key, value] of Object.entries(node)) {
            const path = [...prefix, key];
            const where = `tokens.${path.join('.')}`;
            if (!TOKEN_SEGMENT.test(key)) {
                context.errors.push(buildError('SUI-BUILD-NAME', { file: context.file, name: key }));
            } else if (kindOf(value) === 'object') {
                if (Object.keys(asObject(value)).length === 0) {
                    context.errors.push(buildError('SUI-BUILD-SHAPE', { file: context.file, name: where }));
                } else walk(asObject(value), path);
            } else if (typeof value !== 'string') {
                context.errors.push(buildError('SUI-BUILD-SHAPE', { file: context.file, name: where }));
            } else {
                const result = inferComponentDefault(value);
                if ('reason' in result) {
                    context.errors.push(
                        buildError('SUI-BUILD-TOKENDEF', { file: context.file, name: path.join('.'), other: result.reason })
                    );
                } else tokens.push({ path: path.join('.'), group: '', type: result.type, default: value.trim() });
            }
        }
    };
    if (Object.keys(input).length === 0) {
        context.errors.push(invalid(context, 'tokens'));
        return;
    }
    walk(input, []);
    shape.tokens = tokens;
}

/** Gives each declared token its group (`tokenGroup`, or the component name when that is one lower-case word) */
function resolveTokenGroup(shape: Shape, context: RuleContext): void {
    if (shape.tokens === undefined) return;
    const group = shape.tokenGroup ?? context.component ?? '';
    if (!TOKEN_GROUP.test(group) || tokenLayer(group) !== 'component') {
        context.errors.push(buildError('SUI-BUILD-TOKENGROUP', { file: context.file, component: context.component ?? group }));
        return;
    }
    shape.tokens = shape.tokens.map((token) => ({ ...token, group, path: `${group}.${token.path}` }));
}

/**
 * The checks and additions that need the whole shape, run after every key is read: an own property may not use an
 * articulation name (a modal's width choice is `width`, not `size`), and `hidden` is added to every shape
 */
export function finishShape(shape: Shape, context: RuleContext): void {
    for (const name of Object.keys(shape.properties)) {
        if (isArticulationName(name) && !shape.shared.includes(name)) {
            context.errors.push(buildError('SUI-BUILD-SHAPE', { file: context.file, name: `properties.${name}` }));
        }
    }
    resolveTokenGroup(shape, context);
    if (shape.layout && shape.placement !== undefined) {
        context.errors.push(buildError('SUI-BUILD-SHAPE', { file: context.file, name: 'placement' }));
    }
    for (const [command, property] of Object.entries(shape.commandValues ?? {})) {
        const type = Object.hasOwn(shape.properties, property) ? shape.properties[property]?.type : undefined;
        const isMap = type === 'map' || (Array.isArray(type) && type.includes('map'));
        if (!shape.commands.includes(command) || !isMap) {
            context.errors.push(buildError('SUI-BUILD-SHAPE', { file: context.file, name: `commandValues.${command}` }));
        }
    }
    if (context.errors.length > 0) return;
    shape.properties[HIDDEN] = {
        type: 'boolean',
        required: false,
        validators: {},
        runtime: false,
        reflect: true,
        row: false,
        exposed: false
    };
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
            shape.properties = readProperties(asObject(value), { ...context, where: 'properties' });
        }
    },
    {
        name: 'shared',
        type: 'object',
        required: false,
        rule(value, shape, context) {
            readShared(asObject(value), shape, context);
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
        name: 'commandValues',
        type: 'object',
        required: false,
        rule(value, shape, context) {
            const input = asObject(value);
            const valid =
                Object.keys(input).length > 0 &&
                Object.entries(input).every(([command, property]) => EVENT_NAME.test(command) && typeof property === 'string');
            if (!valid) {
                context.errors.push(invalid(context, 'commandValues'));
                return;
            }
            shape.commandValues = input as Record<string, string>;
        }
    },
    {
        name: 'childComponents',
        type: 'array',
        required: false,
        rule(value, shape, context) {
            const names = readComponentNames(value);
            if (names === undefined) {
                context.errors.push(invalid(context, 'childComponents'));
                return;
            }
            shape.childComponents = names;
        }
    },
    {
        name: 'layout',
        type: 'boolean',
        required: false,
        rule(value, shape) {
            shape.layout = value === true;
        }
    },
    {
        name: 'placement',
        type: 'object',
        required: false,
        rule(value, shape, context) {
            const input = asObject(value);
            if (Object.keys(input).length === 0) {
                context.errors.push(invalid(context, 'placement'));
                return;
            }
            shape.placement = readProperties(input, { ...context, where: 'placement', nested: true });
        }
    },
    {
        name: 'tokens',
        type: 'object',
        required: false,
        rule(value, shape, context) {
            readTokens(asObject(value), shape, context);
        }
    },
    {
        name: 'tokenGroup',
        type: 'string',
        required: false,
        rule(value, shape) {
            shape.tokenGroup = value as string;
        }
    },
    {
        // Optional here: `BuildOptions.requireSearchKeys` makes a missing one an error
        name: 'category',
        type: 'any',
        required: false,
        rule(value, shape, context) {
            if (!isComponentCategory(value)) {
                context.errors.push(categoryError(context.file));
                return;
            }
            shape.category = value;
        }
    },
    {
        name: 'purposes',
        type: 'any',
        required: false,
        rule(value, shape, context) {
            const reason = checkPurposes(value);
            if (reason !== undefined) {
                context.errors.push(purposesError(context.file, reason));
                return;
            }
            shape.purposes = [...(value as string[])];
        }
    }
];
