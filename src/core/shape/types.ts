import type { JsonValue } from '../types.js';

/** The value types a property can have. `url` is checked by the URL rule, `icon` is a name, `node` is a slot */
export const PROPERTY_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'any', 'url', 'icon', 'node'] as const;

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

/** One property of a shape */
export interface PropertyShape {
    type: PropertyType;
    default?: JsonValue;
    required: boolean;
    /** `content` for the `_` properties an overlay may translate; absent otherwise */
    kind?: 'content';
    /** The allowed values; absent means any value of the type */
    values?: JsonValue[];
    validators: ValidatorOptions;
}

/** A parsed `*.state.json`: defaults, validation rules and the catalog entry of one component */
export interface Shape {
    /** One line, at most MAX_SUMMARY_LENGTH characters */
    summary: string;
    properties: Record<string, PropertyShape>;
    events: string[];
    commands: string[];
    /** True when the component lays out children, so a node may carry `layout` */
    layout: boolean;
}

/** Longest allowed summary, in characters */
export const MAX_SUMMARY_LENGTH = 120;

/** Longest allowed `pattern` validator expression, in characters */
export const MAX_PATTERN_LENGTH = 200;

/** Longest string a `pattern` validator will test; longer strings fail it */
export const MAX_PATTERN_INPUT = 10000;
