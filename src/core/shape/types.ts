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

/** The options of each named validator. The set of names is closed */
export interface ValidatorOptions {
    oneOf?: JsonValue[];
    pattern?: string;
    range?: Bounds;
    length?: Bounds;
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
    /** True when the component lays out children, so a node may carry `layout` */
    layout: boolean;
    /**
     * The placement fields a node under this component may carry, when the component has no `layout` (tabs: `_tab`,
     * `icon`, `badge`). Absent when the component declares none; a shape cannot have both `layout` and `placement`
     */
    placement?: Record<string, PropertyShape>;
}

/** Longest allowed summary, in characters */
export const MAX_SUMMARY_LENGTH = 120;

/** Longest allowed `pattern` validator expression, in characters */
export const MAX_PATTERN_LENGTH = 200;

/** Longest string a `pattern` validator will test; longer strings fail it */
export const MAX_PATTERN_INPUT = 10000;
