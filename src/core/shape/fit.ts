import type { JsonValue } from '../types.js';
import type { PropertyShape, PropertyType } from './types.js';
import { isSafeUrl } from './url.js';
import { passesValidators } from './validators.js';

/** Icon names the core accepts without an icon list: lower-case letters, digits and `-`; empty means no icon */
const ICON_NAME = /^[a-z0-9-]*$/;

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The types of a property as a list, whether it names one or several */
export function typesOf(property: Pick<PropertyShape, 'type'>): readonly PropertyType[] {
    return Array.isArray(property.type) ? property.type : [property.type as PropertyType];
}

/** True when the value has the type; `url` also applies the URL rule and `node` needs a `component` name */
export function fitsType(type: Exclude<PropertyType, 'map'>, value: JsonValue): boolean {
    switch (type) {
        case 'string':
            return typeof value === 'string';
        case 'icon':
            return typeof value === 'string' && ICON_NAME.test(value);
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

/** True when the value is a map that fits `items`: every value is a string, or an object whose fields all fit */
function fitsMap(property: PropertyShape, value: JsonValue): boolean {
    const items = property.items;
    if (!isObject(value) || items === undefined) return false;
    return Object.values(value).every((entry) => {
        if (items === 'string') return typeof entry === 'string';
        if (!isObject(entry)) return false;
        return Object.entries(entry).every(
            ([name, field]) => Object.hasOwn(items, name) && fitsProperty(items[name] as PropertyShape, field)
        );
    });
}

/** True when the value fits one of the property's types */
export function fitsAnyType(property: PropertyShape, value: JsonValue): boolean {
    return typesOf(property).some((type) => (type === 'map' ? fitsMap(property, value) : fitsType(type, value)));
}

/** True when the value fits the property's type, allowed values and validators */
export function fitsProperty(property: PropertyShape, value: JsonValue): boolean {
    if (!fitsAnyType(property, value)) return false;
    if (property.values && !property.values.some((allowed) => JSON.stringify(allowed) === JSON.stringify(value))) return false;
    return passesValidators(value, property.validators);
}
