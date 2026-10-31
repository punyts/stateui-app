import { validateTokenValue } from '../theme/value.js';
import type { JsonValue } from '../types.js';
import type { FieldSpec } from './types.js';

/** A literal dimension: `validateTokenValue` accepts it and it holds neither `calc()` nor a reference */
function isLiteralDimension(value: JsonValue): boolean {
    if (typeof value !== 'string' || value !== value.trim() || /[{}]|calc\(/i.test(value)) return false;
    return validateTokenValue('dimension', value);
}

/** True when the value is allowed by the spec */
export function fitsField(spec: FieldSpec, value: JsonValue): boolean {
    switch (spec.type) {
        case 'enum':
            return typeof value === 'string' && spec.values.includes(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value) && value >= spec.min && value <= spec.max;
        case 'number':
            return typeof value === 'number' && Number.isFinite(value) && value >= spec.min && value <= spec.max;
        case 'dimension':
            return isLiteralDimension(value);
    }
}
