import { describe, expect, it } from 'vitest';
import { recordKeys } from './recordKeys.js';

describe('recordKeys', () => {
    it('should key an array by distinct ids, each with its index as the record key', () => {
        expect(recordKeys([{ id: 'a' }, { id: 2 }])).toEqual([
            { key: 'a', recordKey: '0' },
            { key: '2', recordKey: '1' }
        ]);
    });

    it('should key an array by index when an id is missing, repeated or not a path segment', () => {
        expect(recordKeys([{ id: 'a' }, { id: 'a' }]).map((entry) => entry.key)).toEqual(['0', '1']);
        expect(recordKeys([{ id: 'a b' }, 4]).map((entry) => entry.key)).toEqual(['0', '1']);
        expect(recordKeys([{ id: 'a' }, { label: 'no id' }]).map((entry) => entry.key)).toEqual(['0', '1']);
    });

    it('should key a map by its own keys and give nothing for anything else', () => {
        expect(recordKeys({ x: {}, y: {} })).toEqual([
            { key: 'x', recordKey: 'x' },
            { key: 'y', recordKey: 'y' }
        ]);
        expect(recordKeys(null)).toEqual([]);
        expect(recordKeys(undefined)).toEqual([]);
        expect(recordKeys('text')).toEqual([]);
    });
});
