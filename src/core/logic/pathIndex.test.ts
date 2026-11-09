import { describe, expect, it } from 'vitest';
import { createLogicEngine } from './engine.js';
import { PathIndex } from './pathIndex.js';
import { compilePattern } from './pattern.js';
import type { PathPattern } from './pattern.js';
import type { JsonValue } from '../types.js';
import type { LogicDocument, LogicWrite } from './types.js';

function indexOf(...sources: string[]): PathIndex<string> {
    const index = new PathIndex<string>();
    for (const source of sources) index.add(compilePattern(source) as PathPattern, source);
    return index;
}

describe('PathIndex', () => {
    it('should find the patterns a change is at or below', () => {
        // Arrange
        const index = indexOf('$.data.a', '$.data.a.b', '$.data.c', '$.app.x');

        // Act
        const found = index.find('$.data.a.b.c');

        // Assert
        expect([...found].sort()).toEqual(['$.data.a', '$.data.a.b']);
    });

    it('should find the patterns below a change that replaced their parent', () => {
        // Arrange
        const index = indexOf('$.data.bag.{id}.qty', '$.data.bag.*.price', '$.data.other');

        // Act
        const found = index.find('$.data.bag');

        // Assert
        expect([...found].sort()).toEqual(['$.data.bag.*.price', '$.data.bag.{id}.qty']);
    });

    it('should follow both the literal and the wildcard branch of a step', () => {
        // Arrange
        const index = indexOf('$.data.tasks.{task}.done', '$.data.tasks.t1.done', '$.data.tasks.t2.done');

        // Act
        const found = index.find('$.data.tasks.t1.done');

        // Assert
        expect([...found].sort()).toEqual(['$.data.tasks.t1.done', '$.data.tasks.{task}.done']);
    });

    it('should find every pattern for a change at the root', () => {
        // Arrange
        const index = indexOf('$.data.a', '$.app.b');

        // Act / Assert
        expect(index.find('$').size).toBe(2);
    });
});

describe('createLogicEngine: dispatch through the path index', () => {
    it('should look at the rules whose paths match a change, not at every rule', () => {
        // Arrange: 500 rules on distinct paths, and a host that counts its reads
        const rules: NonNullable<LogicDocument['rules']> = {};
        for (let index = 0; index < 500; index += 1) {
            rules[`r${index}`] = { when: { path: `$.data.in_r${index}` }, do: [{ command: 'set', target: `$.data.out_r${index}`, value: '$trigger' }] };
        }
        const state: Record<string, JsonValue> = {};
        let reads = 0;
        const engine = createLogicEngine(
            { rules },
            {
                get: (path) => {
                    reads += 1;
                    return state[path];
                },
                commit: (writes: readonly LogicWrite[]) => {
                    for (const write of writes) if (write.value !== undefined) state[write.path] = write.value;
                }
            }
        );
        state['$.data.in_r7'] = 3;

        // Act
        engine.changes([{ path: '$.data.in_r7', value: 3 }]);

        // Assert: one rule fired, and the reads do not grow with the number of rules
        expect(state['$.data.out_r7']).toBe(3);
        expect(reads).toBeLessThan(20);
    });
});
