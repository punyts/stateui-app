import { describe, expect, it } from 'vitest';
import { logicFor, readLogic } from './index.js';
import type { LogicDocument } from './index.js';

const SET_COUNT = [{ command: 'set', target: '$.data.stats.count', value: '{{ size($.data.items) }}' }];

describe('readLogic: runs', () => {
    it('should keep runs on every kind of unit that may run in the browser', () => {
        // Arrange
        const logic = {
            machines: { phase: { runs: 'browser', state: '$.data.phase', initial: 'idle', transitions: [{ when: { path: '$.data.go' }, to: 'idle' }] } },
            rules: { count: { runs: 'browser', when: { path: '$.data.items' }, do: SET_COUNT } },
            tables: { fee: { runs: 'browser', inputs: { total: '$.data.total' }, outputs: { fee: '$.data.fee' }, rows: [{ fee: 5 }] } },
            computes: { tax: { runs: 'server', inputs: { total: '$.data.total' }, run: '$.functions.host.tax', outputs: { tax: '$.data.tax' } } }
        };

        // Act
        const result = readLogic(logic);

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.logic.machines?.['phase']?.runs).toBe('browser');
        expect(result.logic.rules?.['count']?.runs).toBe('browser');
        expect(result.logic.tables?.['fee']?.runs).toBe('browser');
        expect(result.logic.computes?.['tax']?.runs).toBe('server');
    });

    it('should leave runs absent on a unit that does not give it', () => {
        // Act
        const result = readLogic({ rules: { count: { when: { path: '$.data.items' }, do: SET_COUNT } } });

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.logic.rules?.['count']).not.toHaveProperty('runs');
    });

    it('should refuse a runs that is neither server nor browser with SUI-LOGIC-SHAPE', () => {
        // Act
        const result = readLogic({ rules: { count: { runs: 'edge', when: { path: '$.data.items' }, do: SET_COUNT } } });

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-LOGIC-SHAPE', '$.logic.rules.count.runs']]);
        expect(result.logic.rules).toBeUndefined();
    });

    it('should refuse a guard in the browser, since a guard protects the data', () => {
        // Act
        const result = readLogic({ rules: { noDrafts: { runs: 'browser', when: { path: '$.data.items.{id}' }, do: [{ command: 'reject', reason: 'No' }] } } });

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-LOGIC-RUNS', '$.logic.rules.noDrafts']]);
        expect(result.errors[0]?.message).toContain('a guard protects the data');
        expect(result.logic.rules).toBeUndefined();
    });

    it('should refuse an effect in the browser, since its secrets are on the server', () => {
        // Act
        const result = readLogic({ effects: { fetch: { runs: 'browser', request: '$.data.request', run: '$.functions.host.ordersFetch', status: '$.data.status' } } });

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-LOGIC-RUNS', '$.logic.effects.fetch']]);
        expect(result.errors[0]?.message).toContain('secrets are on the server');
        expect(result.logic.effects).toBeUndefined();
    });

    it('should refuse a browser machine with a call command, since the server answers it', () => {
        // Arrange
        const machine = {
            runs: 'browser',
            state: '$.data.phase',
            initial: 'idle',
            transitions: [{ when: { path: '$.data.go' }, to: 'idle', do: [{ command: 'call', target: 'charge', as: 'paid' }] }]
        };

        // Act
        const result = readLogic({ machines: { pay: machine } });

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-LOGIC-RUNS', '$.logic.machines.pay.transitions.0.do.0']]);
        expect(result.errors[0]?.message).toContain('"call" is answered by the server');
        expect(result.logic.machines).toBeUndefined();
    });

    it('should refuse a browser unit that reads or writes a $.server path, naming where, never the value', () => {
        // Arrange
        const logic = {
            rules: {
                reads: { runs: 'browser', when: { path: '$.data.items' }, do: [{ command: 'set', target: '$.data.total', value: '{{ size($.server.secrets) }}' }] },
                writes: { runs: 'browser', when: { path: '$.data.items' }, do: [{ command: 'set', target: '$.server.audit', value: 'hidden-value' }] },
                server: { runs: 'server', when: { path: '$.server.audit' }, do: SET_COUNT }
            }
        };

        // Act
        const result = readLogic(logic);

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-LOGIC-RUNS', '$.logic.rules.reads.do.0.value'],
            ['SUI-LOGIC-RUNS', '$.logic.rules.writes.do.0.target']
        ]);
        expect(result.errors[1]?.message).toContain('$.server never reaches a browser');
        expect(result.errors[1]?.message).not.toContain('hidden-value');
        expect(Object.keys(result.logic.rules ?? {})).toEqual(['server']);
    });
});

describe('logicFor', () => {
    const logic: LogicDocument = {
        machines: { phase: { runs: 'browser', state: '$.data.phase', initial: 'idle', transitions: [] } },
        rules: {
            plain: { when: { path: '$.data.a' }, do: [] },
            server: { runs: 'server', when: { path: '$.data.b' }, do: [] },
            local: { runs: 'browser', when: { path: '$.data.c' }, do: [] }
        },
        effects: { fetch: { request: '$.data.request', run: '$.functions.host.fetch', status: '$.data.status' } }
    };

    it('should give the server the units without runs and those with runs server', () => {
        // Act
        const server = logicFor(logic, 'server');

        // Assert
        expect(Object.keys(server)).toEqual(['rules', 'effects']);
        expect(Object.keys(server.rules ?? {})).toEqual(['plain', 'server']);
        expect(Object.keys(server.effects ?? {})).toEqual(['fetch']);
    });

    it('should give the browser only the units with runs browser', () => {
        // Act
        const browser = logicFor(logic, 'browser');

        // Assert
        expect(Object.keys(browser)).toEqual(['machines', 'rules']);
        expect(Object.keys(browser.rules ?? {})).toEqual(['local']);
    });

    it('should give an empty document for a side with no units', () => {
        // Act
        const browser = logicFor({ rules: { plain: { when: { path: '$.data.a' }, do: [] } } }, 'browser');

        // Assert
        expect(browser).toEqual({});
    });
});
