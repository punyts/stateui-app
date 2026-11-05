import { declarationProblems, isFieldType, isKeyName } from '../blueprint/declaration.js';
import type { FieldDeclaration, FieldType, ModelPart } from '../blueprint/types.js';
import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { isObject } from '../resolve/merge.js';
import { fitsType } from '../shape/fit.js';
import { passesValidators } from '../shape/validators.js';
import type { JsonObject, JsonValue } from '../types.js';

const MODEL_KEYS = ['fields'];

export interface ReadModelResult {
    /** Absent when there are errors */
    model?: ModelPart;
    errors: BuildError[];
}

function shapeError(path: string, name: string): BuildError {
    return buildError('SUI-MODEL-SHAPE', { path, name });
}

/**
 * Reads a model part (`{ fields }`): each field name is a key name and each field a typed declaration whose type is one
 * of `FIELD_TYPES`, whose validators are the library's closed set and fit the type, and whose default fits its type and
 * its own validators. Each problem is `SUI-MODEL-SHAPE` with its path (`$` is the model)
 */
export function readModel(json: JsonValue): ReadModelResult {
    if (!isObject(json)) return { errors: [shapeError('$', 'a model must be an object { "fields" }')] };
    const errors: BuildError[] = [];
    for (const key of Object.keys(json)) {
        if (!MODEL_KEYS.includes(key)) errors.push(shapeError(`$.${key}`, `unknown key "${key}"`));
    }
    const fields = json['fields'];
    if (!isObject(fields)) {
        errors.push(shapeError('$.fields', 'a model needs fields, an object of typed declarations by field name'));
        return { errors };
    }
    for (const [name, declaration] of Object.entries(fields)) {
        const at = `$.fields.${name}`;
        if (!isKeyName(name)) errors.push(shapeError(at, `field name "${name}" must be a key name`));
        for (const problem of declarationProblems(declaration, at)) errors.push(shapeError(problem.path, problem.reason));
    }
    if (errors.length > 0) return { errors };
    return { model: json as unknown as ModelPart, errors: [] };
}

/** Why a value does not fit its field, or undefined when it fits */
function misfit(declaration: FieldDeclaration, value: JsonValue): string | undefined {
    if (!fitsType(declaration.type, value)) return `must be ${declaration.type}`;
    if (declaration.validators !== undefined && !passesValidators(value, declaration.validators)) return 'fails its validators';
    return undefined;
}

/** True when a record holds no value for the field: the key is absent or the value is null */
function isAbsent(value: JsonValue | undefined): value is undefined | null {
    return value === undefined || value === null;
}

function fieldError(key: string, name: string, reason: string): BuildError {
    return buildError('SUI-MODEL-FIELD', { key, name, reason });
}

/**
 * Checks one record against a model: every value fits its field's type and validators, a required field without a
 * default has a value, and the record has no field the model does not declare. A field set to null counts as absent.
 * Each problem is `SUI-MODEL-FIELD` naming the record `key` and the field. Defaults are not applied (see `applyDefaults`)
 */
export function checkRecord(model: ModelPart, record: JsonValue, key = ''): BuildError[] {
    if (!isObject(record)) return [fieldError(key, '$', 'a record must be an object')];
    const errors: BuildError[] = [];
    for (const [name, declaration] of Object.entries(model.fields)) {
        const value = record[name];
        if (isAbsent(value)) {
            if (declaration.required === true && declaration.default === undefined) errors.push(fieldError(key, name, 'is required'));
            continue;
        }
        const reason = misfit(declaration, value);
        if (reason !== undefined) errors.push(fieldError(key, name, reason));
    }
    for (const name of Object.keys(record)) {
        if (!Object.hasOwn(model.fields, name)) errors.push(fieldError(key, name, 'is not a field of the model'));
    }
    return errors;
}

/** Checks every record of a dataset (records by record key) with `checkRecord` */
export function checkDataset(model: ModelPart, records: Readonly<Record<string, JsonValue>>): BuildError[] {
    return Object.entries(records).flatMap(([key, record]) => checkRecord(model, record, key));
}

/**
 * A copy of the record with the default of every field it holds no value for (absent or null), in the model's field
 * order, followed by the record's other keys. The record itself is not changed
 */
export function applyDefaults(model: ModelPart, record: Readonly<JsonObject>): JsonObject {
    const filled: JsonObject = {};
    for (const [name, declaration] of Object.entries(model.fields)) {
        const value = record[name];
        if (!isAbsent(value)) filled[name] = structuredClone(value);
        else if (declaration.default !== undefined) filled[name] = structuredClone(declaration.default);
        else if (value === null) filled[name] = null;
    }
    for (const [name, value] of Object.entries(record)) {
        if (!Object.hasOwn(filled, name) && value !== undefined) filled[name] = structuredClone(value);
    }
    return filled;
}

/** The field type of one JSON value; undefined for null, which says nothing about the type */
function typeOfValue(value: JsonValue): FieldType | undefined {
    if (value === null) return undefined;
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
    if (typeof value === 'boolean') return 'boolean';
    return Array.isArray(value) ? 'array' : 'object';
}

/** The type two sample types share: integers and numbers make a number, any other mix makes `any` */
function joinTypes(a: FieldType | undefined, b: FieldType | undefined): FieldType | undefined {
    if (a === undefined) return b;
    if (b === undefined || a === b) return a;
    const numeric = (type: FieldType): boolean => type === 'integer' || type === 'number';
    return numeric(a) && numeric(b) ? 'number' : 'any';
}

/**
 * A model from sample records (an array, or records by key): one field per name in the order first seen, typed from
 * the JSON values (an integer and a fraction make `number`, other mixes and a field that is only ever null make `any`),
 * every field optional, with no defaults or validators. Values that are not objects are skipped. Field names are kept
 * as found: one that is not a key name makes the model fail `readModel`, for the caller to rename
 */
export function inferModel(records: readonly JsonValue[] | Readonly<Record<string, JsonValue>>): ModelPart {
    const samples = Array.isArray(records) ? records : Object.values(records);
    const types = new Map<string, FieldType | undefined>();
    for (const record of samples) {
        if (!isObject(record)) continue;
        for (const [name, value] of Object.entries(record)) {
            types.set(name, joinTypes(types.get(name), typeOfValue(value)));
        }
    }
    const fields: Record<string, FieldDeclaration> = {};
    for (const [name, type] of types) fields[name] = { type: type !== undefined && isFieldType(type) ? type : 'any' };
    return { fields };
}
