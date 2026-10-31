import type { JsonValue } from '../types.js';
import type { PropertyShape, PropertyType } from './types.js';
import { isSafeUrl } from './url.js';
import { passesValidators } from './validators.js';

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the value has the type; `url` also applies the URL rule and `node` needs a `component` name */
export function fitsType(type: PropertyType, value: JsonValue): boolean {
    switch (type) {
        case 'string':
        case 'icon':
            return typeof value === 'string';
        case 'url':
            return typeof value === 'string' && isSafeUrl(value);
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'array':
            return Array.isArray(value);
        case 'object':
            return isObject(value);
        case 'node':
            return isObject(value) && typeof value.component === 'string' && value.component !== '';
        case 'any':
            return true;
    }
}

/** True when the value fits the property's type, allowed values and validators */
export function fitsProperty(property: PropertyShape, value: JsonValue): boolean {
    if (!fitsType(property.type, value)) return false;
    if (property.values && !property.values.some((allowed) => JSON.stringify(allowed) === JSON.stringify(value))) return false;
    return passesValidators(value, property.validators);
}
