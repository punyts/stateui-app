import { isObject } from '../resolve/merge.js';
import { fitsType } from '../shape/fit.js';
import type { PropertyType, ValidatorOptions } from '../shape/types.js';
import { VALIDATORS, isValidatorName, passesValidators } from '../shape/validators.js';
import type { JsonValue } from '../types.js';
import { FIELD_TYPES } from './types.js';
import type { FieldType } from './types.js';

const DECLARATION_KEYS = ['type', 'default', 'required', 'validators'];

/** A key name: read as `$.data.{name}`, `$params.{name}` or a record field, so a JavaScript identifier without `$` */
const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** True when `value` is a key name: a binding, a param or a model field */
export function isKeyName(value: unknown): value is string {
    return typeof value === 'string' && KEY_NAME.test(value);
}

/** True when `value` is one of `FIELD_TYPES` */
export function isFieldType(value: unknown): value is FieldType {
    return (FIELD_TYPES as readonly unknown[]).includes(value);
}

/** One problem of a declaration: where it is and why */
export interface DeclarationProblem {
    path: string;
    reason: string;
}

/** The problems of the validators of a declaration; none when every validator is known, well formed and fits the type */
function validatorProblems(validators: JsonValue, type: FieldType | undefined, path: string): DeclarationProblem[] {
    if (!isObject(validators)) return [{ path, reason: 'validators must be an object' }];
    const problems: DeclarationProblem[] = [];
    for (const [name, options] of Object.entries(validators)) {
        const at = `${path}.${name}`;
        if (!isValidatorName(name)) {
            problems.push({ path: at, reason: `unknown validator "${name}"` });
            continue;
        }
        const rule = VALIDATORS[name as keyof ValidatorOptions];
        if (rule.parse(options as never) === undefined) problems.push({ path: at, reason: `the options of validator "${name}" are not valid` });
        else if (type !== undefined && type !== 'any' && !rule.applies(type as PropertyType)) {
            problems.push({ path: at, reason: `validator "${name}" does not apply to type ${type}` });
        }
    }
    return problems;
}

/**
 * The problems of one typed declaration (`{ type, default?, required?, validators? }`), as a model field, a module param
 * and a screen param are declared: an unknown key or type, a `required` that is not a boolean, an unknown or malformed
 * validator, one that does not apply to the type, and a default that does not fit the type or its own validators
 */
export function declarationProblems(value: JsonValue, path: string): DeclarationProblem[] {
    if (!isObject(value)) return [{ path, reason: 'must be a typed declaration { "type", "default"?, "required"?, "validators"? }' }];
    const problems: DeclarationProblem[] = [];
    for (const key of Object.keys(value)) {
        if (!DECLARATION_KEYS.includes(key)) problems.push({ path: `${path}.${key}`, reason: `unknown key "${key}"` });
    }
    const type = isFieldType(value['type']) ? value['type'] : undefined;
    if (type === undefined) problems.push({ path: `${path}.type`, reason: `type must be one of ${FIELD_TYPES.join(', ')}` });
    if (value['required'] !== undefined && typeof value['required'] !== 'boolean') problems.push({ path: `${path}.required`, reason: 'must be true or false' });
    const validators = value['validators'];
    const before = problems.length;
    if (validators !== undefined) problems.push(...validatorProblems(validators, type, `${path}.validators`));
    const fallback = value['default'];
    if (fallback === undefined || type === undefined || problems.length > before) return problems;
    if (!fitsType(type, fallback)) problems.push({ path: `${path}.default`, reason: `the default is not of type ${type}` });
    else if (validators !== undefined && !passesValidators(fallback, validators as ValidatorOptions)) {
        problems.push({ path: `${path}.default`, reason: 'the default fails its own validators' });
    }
    return problems;
}
