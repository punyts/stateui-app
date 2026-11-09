import { describe, expect, it } from 'vitest';
import { columnIndex, compileTable, describeIndex, lookupRow, tableColumns } from './table.js';
import type { CompiledTable } from './table.js';
import type { JsonObject } from '../types.js';
import type { LogicTable } from './types.js';

const INPUTS: LogicTable['inputs'] = {
    c: { path: '$.data.c', values: ['r', 'g', '*'] },
    n: { path: '$.data.n', breaks: [10, 20] },
    note: '$.data.note'
};

describe('table columns', () => {
    it('should index a listed value, any other value and number buckets', () => {
        // Arrange
        const [c, n] = tableColumns(INPUTS);

        // Act / Assert
        expect(c).toMatchObject({ name: 'c', count: 3, other: true });
        expect([columnIndex(c!, 'r'), columnIndex(c!, 'g'), columnIndex(c!, 'x'), columnIndex(c!, null)]).toEqual([0, 1, 2, 'missing']);
        expect([columnIndex(n!, 5), columnIndex(n!, 10), columnIndex(n!, 19.5), columnIndex(n!, 20), columnIndex(n!, 'x')]).toEqual([0, 1, 1, 2, 'outside']);
        expect([0, 1, 2].map((index) => describeIndex(n!, index))).toEqual(['below 10', '10 up to 20', '20 and above']);
        expect(describeIndex(c!, 2)).toBe('any other value');
    });

    it('should take the values of a { keys } input from the caller', () => {
        // Act
        const [column] = tableColumns({ k: { path: '$.data.k', values: { keys: '$.data.map' } } }, () => ['a', 'b']);

        // Assert
        expect(column).toMatchObject({ values: ['a', 'b'], count: 2, other: false });
        expect(columnIndex(column!, 'c')).toBe('outside');
    });
});

describe('compileTable', () => {
    it('should refuse a condition on a plain input and a value its column does not list', () => {
        // Act
        const { compiled, problems } = compileTable({ inputs: INPUTS, outputs: { out: '$.data.out' } }, [{ note: 1, out: 1 }, { c: 'b', out: 2 }, { n: '>=15', out: 3 }]);

        // Assert
        expect(compiled).toBeUndefined();
        expect(problems.map((problem) => problem.at)).toEqual(['rows.0.note', 'rows.1.c', 'rows.2.n']);
    });

    it('should name the combinations no row covers', () => {
        // Act
        const { problems } = compileTable({ inputs: INPUTS, outputs: { out: '$.data.out' } }, [{ c: 'r', out: 1 }]);

        // Assert
        expect(problems).toEqual([{ at: 'rows', code: 'gap', message: 'c "g", n below 10; c "g", n 10 up to 20; c "g", n 20 and above (and 3 more)' }]);
    });

    it('should give the same answers compiled as matching its rows in order', () => {
        // Arrange: random rows over two columns, looked up for every combination
        let seed = 7;
        const random = (n: number): number => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % n;
        };
        for (let round = 0; round < 200; round += 1) {
            const rows: JsonObject[] = [];
            const count = 1 + random(6);
            for (let index = 0; index < count; index += 1) {
                const row: JsonObject = { out: index };
                if (random(2) === 0) row['c'] = (['r', 'g', '*', ['r', 'g']] as const)[random(4)] as JsonObject[string];
                if (random(2) === 0) row['n'] = ['>=10', '<20', '>=10 <20', '<10'][random(4)] as string;
                rows.push(row);
            }
            const { compiled } = compileTable({ inputs: INPUTS, outputs: { out: '$.data.out' } }, rows);
            const unrolled = { ...(compiled as CompiledTable), cells: undefined } as CompiledTable;
            for (let c = 0; c < 3; c += 1) {
                for (let n = 0; n < 3; n += 1) {
                    // Act
                    const fast = lookupRow(compiled as CompiledTable, [c, n]);
                    const slow = lookupRow(unrolled, [c, n]);

                    // Assert
                    expect(fast).toBe(slow);
                }
            }
        }
    });
});
