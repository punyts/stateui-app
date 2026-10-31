export { VERSION } from './version.js';
export { ERROR_CATALOG, ERROR_PREFIXES, TEMPLATE_PLACEHOLDERS, buildError, isValid } from './errors/index.js';
export type { BuildError, CatalogEntry, ErrorCode, ErrorDetails, Severity, TemplatePlaceholder } from './errors/index.js';
export { MAX_DATA_BYTES, MAX_DEPTH, MAX_DOCUMENT_BYTES, MAX_NODES, checkLimits } from './limits.js';
export { DOCUMENT_KEYS, PREFIXES, RESERVED_KEYS, RESERVED_KEY_NAMES } from './types.js';
export type { AppDocument, JsonObject, JsonValue, Node, ThemeOverlay, ThemeState } from './types.js';
