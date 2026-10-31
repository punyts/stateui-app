export { VERSION } from './version.js';
export { ERROR_CATALOG, ERROR_PREFIXES, TEMPLATE_PLACEHOLDERS, buildError, isValid } from './errors/index.js';
export type { BuildError, CatalogEntry, ErrorCode, ErrorDetails, Severity, TemplatePlaceholder } from './errors/index.js';
export { MAX_DATA_BYTES, MAX_DEPTH, MAX_DOCUMENT_BYTES, MAX_NODES, checkLimits } from './limits.js';
export { DOCUMENT_KEYS, PREFIXES, RESERVED_KEYS, RESERVED_KEY_NAMES } from './types.js';
export type { AppDocument, JsonObject, JsonValue, Node, ThemeOverlay, ThemeState } from './types.js';
export {
    MAX_PATTERN_INPUT,
    MAX_PATTERN_LENGTH,
    MAX_SUMMARY_LENGTH,
    PROPERTY_KEYS,
    PROPERTY_TYPES,
    SHAPE_KEYS,
    VALIDATORS,
    buildDefaults,
    isSafeUrl,
    parseShape,
    validateNode
} from './shape/index.js';
export type {
    Bounds,
    KeyRule,
    PropertyShape,
    PropertyType,
    RuleContext,
    Shape,
    ShapeResult,
    ValidatorOptions
} from './shape/index.js';
export { scanLibrary } from './convention/index.js';
export type { ComponentFiles, ComponentTier, FileMap, ScanResult, ScannedComponent } from './convention/index.js';
