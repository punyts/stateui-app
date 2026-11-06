export { buildDefaults } from './defaults.js';
export { parseShape } from './parse.js';
export type { ShapeResult } from './parse.js';
export { PROPERTY_KEYS, SHAPE_KEYS, categoryError, purposesError } from './table.js';
export { COMPONENT_CATEGORIES, MAX_PURPOSES, MAX_PURPOSE_LENGTH, MIN_PURPOSES, checkPurposes, isComponentCategory, normalizePurpose } from './categories.js';
export type { ComponentCategory } from './categories.js';
export type { KeyRule, RuleContext } from './table.js';
export {
    MAX_COLOR_LENGTH,
    MAX_PATH_COMMANDS,
    MAX_PATH_DATA_LENGTH,
    MAX_PATTERN_INPUT,
    MAX_PATTERN_LENGTH,
    MAX_POINTS,
    MAX_SUMMARY_LENGTH,
    OBJECT_FIELD_TYPES,
    PROPERTY_TYPES
} from './types.js';
export type {
    Bounds,
    FieldValidators,
    FileRefOptions,
    ObjectField,
    ObjectFieldType,
    PropertyShape,
    PropertyType,
    RequiredWhen,
    Shape,
    ValidatorOptions
} from './types.js';
export { isSafeUrl } from './url.js';
export { VALIDATORS } from './validators.js';
export { validateNode } from './validate.js';
export type { ValidateContext } from './validate.js';
export { reflectedProperties } from './reflect.js';
export { fitsProperty, typesOf } from './fit.js';
export { nodeChildren } from './children.js';
export type { NodeChild } from './children.js';
export { collectComponentTokens } from './componentTokens.js';
export type { CollectedTokens, ShapeSource } from './componentTokens.js';
