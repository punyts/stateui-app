import type { ComponentCategory } from './categories.js';
import type { ComponentToken } from '../theme/types.js';
import type { JsonValue } from '../types.js';

/**
 * The value types a property can have. `url` is checked by the URL rule, `icon` is an icon name, `node` is a slot
 * and `map` is a keyed map described by `items`
 */
export const PROPERTY_TYPES = [
    'string',
    'number',
    'integer',
    'boolean',
    'array',
    'object',
    'any',
    'url',
    'icon',
    'node',
    'map'
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** Bounds for the `range` and `length` validators; at least one is set */
export interface Bounds {
    min?: number;
    max?: number;
}

/** The value types a field of the `fields` validator can have */
export const OBJECT_FIELD_TYPES = ['number', 'string', 'boolean', 'array', 'object'] as const;

export type ObjectFieldType = (typeof OBJECT_FIELD_TYPES)[number];

/** The validators a field of the `fields` validator may carry */
export type FieldValidators = Pick<ValidatorOptions, 'color' | 'pathData' | 'points' | 'vector' | 'fields' | 'fileRef' | 'range' | 'oneOf'>;

/** One field of an object checked by the `fields` validator */
export interface ObjectField {
    /**
     * The type of the value, or a list of types it may have (`["number", "string"]`: `transition.duration` is a number
     * of milliseconds or a `motion.duration.*` name). With a list, `values` restricts only a value of a type its
     * entries have, and each validator checks only a value of a type it applies to
     */
    type: ObjectFieldType | ObjectFieldType[];
    /** The allowed values; absent means any value of the type */
    values?: JsonValue[];
    /** True when the object must hold the field; absent means optional */
    required?: boolean;
    /** The validators run on the field's value; absent means none */
    validators?: FieldValidators;
}

/** The options of the `fileRef` validator */
export interface FileRefOptions {
    /** The media types a file may have (`image/png`), at least one */
    types: string[];
    /** True when a `data:` URL of one of the image types in `types` is accepted as well */
    dataUrl?: boolean;
}

/** The options of each named validator. The set of names is closed */
export interface ValidatorOptions {
    oneOf?: JsonValue[];
    /** The value is a list whose every entry is one of these values (an empty list passes; add `length` for a minimum) */
    eachOf?: JsonValue[];
    pattern?: string;
    /** The value is itself a regular expression of at most this many characters (1 to `MAX_PATTERN_LENGTH`) that compiles and has no nested quantifier */
    regex?: number;
    range?: Bounds;
    length?: Bounds;
    /** The value is a colour: hex, `rgb()`, `rgba()`, `hsl()`, `hsla()`, a token reference `{group.name}` or a paint name. The option is `true` */
    color?: true;
    /** The value is SVG path data that parses, with at most `MAX_PATH_DATA_LENGTH` characters and `MAX_PATH_COMMANDS` commands. The option is `true` */
    pathData?: true;
    /** The value is a list of at most `MAX_POINTS` `[x, y]` pairs of finite numbers. The option is `true` */
    points?: true;
    /** The value is a list of exactly this many (2 or 3) finite numbers */
    vector?: 2 | 3;
    /** The value is an object whose keys are only these fields, each checked by its type, values and validators */
    fields?: Record<string, ObjectField>;
    /** The value is a file reference `{ id, name, size, type }`, or with `dataUrl` a `data:` URL of an image type */
    fileRef?: FileRefOptions;
}

/** A property that is required only while a sibling property holds (or does not hold) a value */
export type RequiredWhen = { property: string; equals: JsonValue } | { property: string; notEquals: JsonValue };

/** One property of a shape */
export interface PropertyShape {
    /** One type, or a list when the property accepts several (`["array", "map"]`) */
    type: PropertyType | PropertyType[];
    default?: JsonValue;
    required: boolean;
    /** `content` for the `_` properties an overlay may translate; absent otherwise */
    kind?: 'content';
    /** The allowed values; absent means any value of the type */
    values?: JsonValue[];
    validators: ValidatorOptions;
    /** Set when a type is `map`: `"string"` for string values, or the properties each map value (an object) may hold */
    items?: 'string' | Record<string, PropertyShape>;
    /** The property is required only while a sibling property holds (or does not hold) a value */
    requiredWhen?: RequiredWhen;
    /** True when only controllers write the property: it has a default and a node may not set it */
    runtime: boolean;
    /** True when `<sui-node>` writes the property as a host attribute */
    reflect: boolean;
    /** True when a `node` property (or a node field of a map item) is a row template, where `$row` is legal */
    row: boolean;
    /** True when the property is a runtime property other nodes may link to by node reference (`^orders.current`) */
    exposed: boolean;
    /** Set on a `node` property: the components the slot accepts; a node of any other component in it is `SUI-NODE-CHILD`. Absent means any */
    childComponents?: string[];
}

/** A parsed `*.state.json`: defaults, validation rules and the catalog entry of one component */
export interface Shape {
    /** One line, at most MAX_SUMMARY_LENGTH characters */
    summary: string;
    /** Own properties and the expanded shared ones (`shared` names, then `hidden`) */
    properties: Record<string, PropertyShape>;
    /** The shared properties the shape declares (`tone`, `size`, ...) in declaration order; `hidden` is always there and not listed */
    shared: string[];
    events: string[];
    commands: string[];
    /**
     * Commands whose `value` must be a key of one of the component's `map` properties (`toastRegion`: `{ show:
     * "messages" }`), so `validateOn` can check a literal value. Absent when the shape declares none
     */
    commandValues?: Record<string, string>;
    /** The components the `children` slot accepts (`accordion`: `disclosure`); a child of any other component is `SUI-NODE-CHILD`. Absent means any */
    childComponents?: string[];
    /** True when the component lays out children, so a node may carry `layout` */
    layout: boolean;
    /**
     * The placement fields a node under this component may carry, when the component has no `layout` (tabs: `_tab`,
     * `icon`, `badge`). Absent when the component declares none; a shape cannot have both `layout` and `placement`
     */
    placement?: Record<string, PropertyShape>;
    /**
     * The component tokens the shape declares, with the full dotted path (`button.radius`), the group, the type
     * inferred from the default and the default. Absent when the shape declares none
     */
    tokens?: ComponentToken[];
    /** The `tokenGroup` the shape sets; absent when the group is the component name */
    tokenGroup?: string;
    /** The component's category, for search and the category index; absent until the library curates it */
    category?: ComponentCategory;
    /** Three to eight one-line phrases of what the component is for, searched first; absent until curated */
    purposes?: string[];
}

/** Longest allowed summary, in characters */
export const MAX_SUMMARY_LENGTH = 120;

/** Longest allowed `pattern` validator expression, in characters */
export const MAX_PATTERN_LENGTH = 200;

/** Longest string a `pattern` validator will test; longer strings fail it */
export const MAX_PATTERN_INPUT = 10000;

/** Longest string the `color` validator accepts, in characters */
export const MAX_COLOR_LENGTH = 100;

/** Longest path data the `pathData` validator accepts, in characters */
export const MAX_PATH_DATA_LENGTH = 4000;

/** Most commands path data may hold for the `pathData` validator (an implicit repeat counts as a command) */
export const MAX_PATH_COMMANDS = 2000;

/** Most `[x, y]` pairs the `points` validator accepts */
export const MAX_POINTS = 10000;
