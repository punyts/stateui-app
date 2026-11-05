import { describe, expect, it } from 'vitest';
import { logicRunOrder } from './index.js';
import type { LogicDocument } from './index.js';

function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null) {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

/** A bag whose rule sums line totals that a table writes; the rule comes first in the document */
const BAG = deepFreeze({
    machines: { checkout: { state: '$.data.checkout', initial: 'idle', transitions: [{ from: 'idle', when: { path: '$.data.pay', is: true }, to: 'paying' }] } },
    rules: {
        totals: { when: { path: '$.data.bag' }, do: [{ command: 'set', target: '$.data.totals.net', value: "{{ sum($.data.bag, 'lineTotal') }}" }] },
        noNegative: { when: { path: '$.data.bag.*.qty', if: '$value < 0' }, do: [{ command: 'reject', reason: 'No negative quantities' }] }
    },
    tables: {
        lines: {
            when: { path: '$.data.bag.{id}.qty' },
            inputs: { price: '$.data.prices.{id}' },
            rows: [{ do: [{ command: 'set', target: '$.data.bag.{id}.lineTotal', value: '{{ $value * $inputs.price }}' }] }]
        }
    }
}) as unknown as LogicDocument;

describe('logicRunOrder', () => {
    it('should place a rule over the bag after the table that writes its line totals, with the paths each reads and writes', () => {
        // Act
        const order = logicRunOrder(BAG);

        // Assert
        expect(order).toEqual([
            { kind: 'machine', name: 'checkout', position: 1, reads: ['$.data.pay'], writes: ['$.data.checkout'] },
            { kind: 'table', name: 'lines', position: 2, reads: ['$.data.bag.{id}.qty', '$.data.prices.{id}'], writes: ['$.data.bag.{id}.lineTotal'] },
            { kind: 'rule', name: 'totals', position: 3, reads: ['$.data.bag'], writes: ['$.data.totals.net'] },
            { kind: 'guard', name: 'noNegative', reads: ['$.data.bag.*.qty'], writes: [] }
        ]);
    });

    it('should give an empty order for a document without units', () => {
        // Act / Assert
        expect(logicRunOrder({})).toEqual([]);
    });
});
