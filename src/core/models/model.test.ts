import { describe, expect, it } from 'vitest';
import type { ModelPart } from '../blueprint/types.js';
import type { BuildError } from '../errors/index.js';
import type { JsonValue } from '../types.js';
import { applyDefaults, checkDataset, checkRecord, inferModel, readModel } from './model.js';

/** A product: a required name, a price in a range, a status from a list, a date as a patterned string and tags */
const PRODUCT = Object.freeze({
    fields: Object.freeze({
        name: Object.freeze({ type: 'string', required: true, validators: Object.freeze({ length: Object.freeze({ min: 1, max: 80 }) }) }),
        price: Object.freeze({ type: 'number', default: 0, validators: Object.freeze({ range: Object.freeze({ min: 0 }) }) }),
        status: Object.freeze({ type: 'string', default: 'draft', validators: Object.freeze({ oneOf: Object.freeze(['draft', 'live']) }) }),
        released: Object.freeze({ type: 'string', validators: Object.freeze({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) }),
        tags: Object.freeze({ type: 'array', default: Object.freeze([]) }),
        sku: Object.freeze({ type: 'string', required: true, default: 'none' })
    })
}) as unknown as ModelPart;

const reasons = (errors: BuildError[]): string[] => errors.map((error) => `${error.code} ${error.message}`);

describe('readModel', () => {
    it('should read a model whose fields are typed declarations', () => {
        // Act
        const result = readModel(JSON.parse(JSON.stringify(PRODUCT)) as JsonValue);

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.model?.fields['price']).toEqual({ type: 'number', default: 0, validators: { range: { min: 0 } } });
    });

    it('should report an unknown type, a default that fails its own validators and a field name that is not a key name', () => {
        // Arrange
        const json = {
            fields: {
                due: { type: 'date' },
                status: { type: 'string', default: 'gone', validators: { oneOf: ['draft', 'live'] } },
                'unit-price': { type: 'number' }
            }
        };

        // Act
        const result = readModel(json);

        // Assert
        expect(result.model).toBeUndefined();
        expect(reasons(result.errors)).toEqual([
            'SUI-MODEL-SHAPE Model at $.fields.due.type is not valid: type must be one of string, number, integer, boolean, array, object, any, url',
            'SUI-MODEL-SHAPE Model at $.fields.status.default is not valid: the default fails its own validators',
            'SUI-MODEL-SHAPE Model at $.fields.unit-price is not valid: field name "unit-price" must be a key name'
        ]);
    });

    it('should report a default of the wrong type, unknown or malformed validators and one that does not fit the type', () => {
        // Arrange
        const json = {
            fields: {
                count: { type: 'integer', default: 1.5 },
                code: { type: 'string', validators: { enum: ['a'], pattern: '(' } },
                age: { type: 'number', validators: { pattern: '^\\d+$' } },
                note: { type: 'any', validators: { pattern: '^n' } }
            },
            title: 'Products'
        };

        // Act
        const paths = readModel(json).errors.map((error) => error.message);

        // Assert
        expect(paths).toEqual([
            'Model at $.title is not valid: unknown key "title"',
            'Model at $.fields.count.default is not valid: the default is not of type integer',
            'Model at $.fields.code.validators.enum is not valid: unknown validator "enum"',
            'Model at $.fields.code.validators.pattern is not valid: the options of validator "pattern" are not valid',
            'Model at $.fields.age.validators.pattern is not valid: validator "pattern" does not apply to type number'
        ]);
    });

    it('should refuse a model that is not an object or has no fields', () => {
        // Act
        const messages = [readModel([]), readModel({}), readModel({ fields: [] })].map((result) => result.errors.map((error) => error.message));

        // Assert
        expect(messages).toEqual([
            ['Model at $ is not valid: a model must be an object { "fields" }'],
            ['Model at $.fields is not valid: a model needs fields, an object of typed declarations by field name'],
            ['Model at $.fields is not valid: a model needs fields, an object of typed declarations by field name']
        ]);
    });
});

describe('checkRecord', () => {
    it('should accept a record that fits, with absent and null optional fields', () => {
        // Act
        const errors = checkRecord(PRODUCT, { name: 'Lamp', price: 12.5, status: 'live', released: '2026-01-31', tags: ['home'], sku: null }, 'p1');

        // Assert
        expect(errors).toEqual([]);
    });

    it('should name the record and the field of each value that does not fit', () => {
        // Act
        const errors = checkRecord(PRODUCT, { price: -1, status: 'gone', released: '31.01.2026', tags: 'home', colour: 'red' }, 'p2');

        // Assert
        expect(errors.map((error) => error.message)).toEqual([
            'Field "name" of record "p2" does not fit its model: is required',
            'Field "price" of record "p2" does not fit its model: fails its validators',
            'Field "status" of record "p2" does not fit its model: fails its validators',
            'Field "released" of record "p2" does not fit its model: fails its validators',
            'Field "tags" of record "p2" does not fit its model: must be array',
            'Field "colour" of record "p2" does not fit its model: is not a field of the model'
        ]);
        expect(new Set(errors.map((error) => error.code))).toEqual(new Set(['SUI-MODEL-FIELD']));
    });

    it('should refuse a record that is not an object', () => {
        // Act
        const errors = checkRecord(PRODUCT, ['Lamp'], 'p3');

        // Assert
        expect(errors.map((error) => error.message)).toEqual(['Field "$" of record "p3" does not fit its model: a record must be an object']);
    });
});

describe('checkDataset', () => {
    it('should check every record by its key', () => {
        // Arrange
        const records = Object.freeze({ p1: Object.freeze({ name: 'Lamp' }), p2: Object.freeze({ name: '' }), p3: Object.freeze({ name: 'Desk', price: 'cheap' }) });

        // Act
        const errors = checkDataset(PRODUCT, records);

        // Assert
        expect(errors.map((error) => error.message)).toEqual([
            'Field "name" of record "p2" does not fit its model: fails its validators',
            'Field "price" of record "p3" does not fit its model: must be number'
        ]);
    });
});

describe('applyDefaults', () => {
    it('should fill the defaults of absent and null fields in field order, keep the other keys and leave the record alone', () => {
        // Arrange
        const record = Object.freeze({ extra: 1, name: 'Lamp', status: null, released: null });

        // Act
        const filled = applyDefaults(PRODUCT, record);
        (filled['tags'] as JsonValue[]).push('changed');

        // Assert
        expect(filled).toEqual({ name: 'Lamp', price: 0, status: 'draft', released: null, tags: ['changed'], sku: 'none', extra: 1 });
        expect(Object.keys(filled)).toEqual(['name', 'price', 'status', 'released', 'tags', 'sku', 'extra']);
        expect(PRODUCT.fields['tags']?.default).toEqual([]);
    });
});

describe('inferModel', () => {
    it('should type each field from the samples, all optional, in the order first seen', () => {
        // Arrange
        const records = [
            { name: 'Lamp', qty: 1, price: 10, live: true, tags: ['a'], size: { w: 1 }, note: null },
            { name: 'Desk', qty: 2, price: 12.5, live: false, extra: 'x', mixed: 1 },
            { name: 'Chair', mixed: 'one', note: null },
            'not a record'
        ];

        // Act
        const model = inferModel(records);

        // Assert
        expect(model).toEqual({
            fields: {
                name: { type: 'string' },
                qty: { type: 'integer' },
                price: { type: 'number' },
                live: { type: 'boolean' },
                tags: { type: 'array' },
                size: { type: 'object' },
                note: { type: 'any' },
                extra: { type: 'string' },
                mixed: { type: 'any' }
            }
        });
        expect(readModel(model as unknown as JsonValue).errors).toEqual([]);
        expect(checkDataset(model, { r1: records[0] as JsonValue, r2: records[1] as JsonValue })).toEqual([]);
    });

    it('should take records by key', () => {
        // Act
        const model = inferModel({ a: { id: 'a' }, b: { id: 'b' } });

        // Assert
        expect(model).toEqual({ fields: { id: { type: 'string' } } });
    });
});
