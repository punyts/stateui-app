import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../types.js';
import { queryRecords } from './query.js';
import { LogicError } from './values.js';

function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null) {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

/** Twelve products, r1 to r12, priced 10 to 120 and in two colors */
const PRODUCTS = deepFreeze(
    Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`r${index + 1}`, { price: (index + 1) * 10, color: index % 2 === 0 ? 'red' : 'blue' }]))
) as JsonObject;

describe('queryRecords', () => {
    it('should return the window and the total before windowing', () => {
        // Act
        const found = queryRecords(PRODUCTS, { window: { first: 10, count: 5 } });

        // Assert
        expect(found.rows.map(([key]) => key)).toEqual(['r11', 'r12']);
        expect(found).toMatchObject({ first: 10, total: 12 });
    });

    it('should filter with $record and $key and sort descending by a field', () => {
        // Act
        const found = queryRecords(PRODUCTS, { filter: "$record.color == 'red' && $key != 'r1'", sort: '-price', window: { first: 0, count: 2 } });

        // Assert
        expect(found.rows).toEqual([
            ['r11', { price: 110, color: 'red' }],
            ['r9', { price: 90, color: 'red' }]
        ]);
        expect(found.total).toBe(5);
    });

    it('should sort by { by, direction }, keep equal records in map order and put missing values last', () => {
        // Arrange
        const records = deepFreeze({ a: { n: 2 }, b: { n: 1 }, c: {}, d: { n: 1 }, e: 'not a record' }) as JsonObject;

        // Act
        const found = queryRecords(records, { sort: { by: 'n', direction: 'asc' } });
        const ignored = queryRecords(records, { sort: { by: '' } });

        // Assert
        expect(found.rows.map(([key]) => key)).toEqual(['b', 'd', 'a', 'c', 'e']);
        expect(ignored.rows.map(([key]) => key)).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('should compare text with numbers in it as numbers, and read the scope it is given', () => {
        // Arrange
        const records = deepFreeze({ x: { code: 'item10' }, y: { code: 'item9' } }) as JsonObject;
        const scope = { read: (path: string) => (path === '$.limit' ? 'item9' : undefined), captures: {} };

        // Act
        const sorted = queryRecords(records, { sort: 'code' });
        const filtered = queryRecords(records, { filter: '$record.code == $.limit' }, scope);

        // Assert
        expect(sorted.rows.map(([key]) => key)).toEqual(['y', 'x']);
        expect(filtered.rows.map(([key]) => key)).toEqual(['y']);
    });

    it('should throw a LogicError for a filter that does not evaluate', () => {
        // Act, Assert
        expect(() => queryRecords(PRODUCTS, { filter: '$record.price >' })).toThrow(LogicError);
    });
});
