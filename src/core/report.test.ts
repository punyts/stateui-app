import { addListener, clearListeners, setCategories } from '@punyts/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORE_APP, STORE_LIBRARY, STORE_PARTS } from './assemble/fixtures/storeApp.js';
import { assembleApp } from './assemble/index.js';
import { hostFunctions } from './functions/fixtures/hostFunctions.js';
import { createLogicEngine } from './logic/index.js';
import type { LogicComputeFunction, LogicDocument, LogicEffectAnswer, LogicEffectFunction, LogicHost, LogicWrite } from './logic/index.js';
import { cloneJson, isObject } from './resolve/merge.js';
import type { JsonObject, JsonValue } from './types.js';
import { validateDocument } from './validate/index.js';

/** A value no report may hold: it is written into state, requests and answers */
const SECRET = 'secret-value-7f3a';

type Seen = { category: string; message: string; details: Record<string, unknown> };

function walk(state: JsonValue, path: string): JsonValue | undefined {
    let current: JsonValue | undefined = state;
    for (const step of path === '$' ? [] : path.slice(2).split('.')) {
        if (!isObject(current) || !Object.hasOwn(current, step)) return undefined;
        current = current[step];
    }
    return current;
}

function stateHost(initial: JsonObject, overrides: Partial<LogicHost> = {}) {
    const root = cloneJson(initial) as JsonObject;
    const apply = (write: LogicWrite): void => {
        const steps = write.path.slice(2).split('.');
        let current = root;
        for (const step of steps.slice(0, -1)) {
            if (!isObject(current[step])) current[step] = {};
            current = current[step] as JsonObject;
        }
        const last = steps[steps.length - 1] as string;
        if (write.value === undefined) delete current[last];
        else current[last] = cloneJson(write.value);
    };
    const host: LogicHost = {
        get: (path) => walk(root, path),
        commit: (writes) => {
            for (const write of writes) apply(write);
        },
        ...overrides
    };
    return { host, apply, get: (path: string) => walk(root, path) };
}

const flush = async (): Promise<void> => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

describe('stateui-app reports', () => {
    let seen: Seen[] = [];
    const listener = (_timestamp: number, category: string, message: string, details?: unknown): void => {
        seen.push({ category, message, details: details as Record<string, unknown> });
    };
    const of = (category: string): Seen[] => seen.filter((report) => report.category === category);

    beforeEach(() => {
        seen = [];
        setCategories(['stateui-app.*']);
        addListener(listener, ['stateui-app.*']);
    });

    afterEach(() => {
        setCategories(['info', 'error', 'stack']);
        clearListeners();
    });

    it('should report an assembly and a validation with counts, codes and durations, and no record value', () => {
        // Arrange
        const parts = cloneJson(STORE_PARTS as unknown as JsonValue) as unknown as typeof STORE_PARTS;

        // Act
        const assembled = assembleApp(STORE_APP, parts, { library: STORE_LIBRARY });
        validateDocument(assembled.document, STORE_LIBRARY, { mode: 'standalone' });
        validateDocument({ app: 42 }, STORE_LIBRARY);

        // Assert
        expect(of('stateui-app.assemble')).toEqual([
            {
                category: 'stateui-app.assemble',
                message: 'App assembled',
                details: { screens: expect.any(Number), uses: expect.objectContaining({ themes: expect.any(Number) }), errors: assembled.errors.length, codes: {}, ms: expect.any(Number) }
            }
        ]);
        const [passed, refused] = of('stateui-app.validate');
        expect(passed?.details).toEqual({ valid: true, mode: 'standalone', errors: 0, warnings: expect.any(Number), codes: expect.any(Object), ms: expect.any(Number) });
        expect(refused?.details).toEqual(expect.objectContaining({ valid: false, errors: 1, codes: expect.objectContaining({}) }));
        expect(Object.keys(refused?.details['codes'] as object)).toHaveLength(1);
        expect(JSON.stringify(seen)).not.toContain('Lamp');
    });

    it('should report machine transitions, rules, tables, computes and effects by name, with no value', async () => {
        // Arrange
        const logic: LogicDocument = {
            machines: {
                door: {
                    state: '$.data.door',
                    initial: 'closed',
                    transitions: [{ from: 'closed', when: { path: '$.data.knock' }, to: 'open' }]
                }
            },
            rules: { copyName: { when: { path: '$.data.name' }, do: [{ command: 'set', target: '$.data.copy', from: '$.data.name' }] } },
            tables: {
                size: {
                    inputs: { kind: { path: '$.data.kind', values: ['a', 'b'] } },
                    outputs: { label: '$.data.label' },
                    rows: [{ kind: 'a', label: SECRET }, { kind: 'b', label: 'B' }]
                }
            },
            computes: { double: { inputs: { net: '$.data.net' }, run: '$.functions.host.double', outputs: { out: '$.data.gross' } } },
            effects: { fetch: { request: '$.data.request', run: '$.functions.host.fetch', status: '$.data.status', value: '$.data.answer' } }
        } as LogicDocument;
        const answers: ((answer: LogicEffectAnswer) => void)[] = [];
        const fetch: LogicEffectFunction = () => new Promise((resolve) => answers.push(resolve));
        const double = (({ net }) => ({ out: typeof net === 'number' ? net * 2 : null })) as LogicComputeFunction;
        const memory = stateHost({ data: {} }, { functions: hostFunctions({ '$.functions.host.double': ['compute', double], '$.functions.host.fetch': ['effect', fetch] }) });
        const engine = createLogicEngine(logic, memory.host);
        engine.start();
        const change = (path: string, value: JsonValue): void => {
            memory.apply({ path, value });
            engine.changes([{ path, value }]);
        };

        // Act
        change('$.data.knock', SECRET);
        change('$.data.name', SECRET);
        change('$.data.kind', 'a');
        change('$.data.net', 21);
        change('$.data.request', { query: SECRET });
        await flush();
        answers[0]?.({ value: SECRET });
        await flush();
        engine.stop();

        // Assert
        expect(of('stateui-app.logic.machine').map((report) => report.details)).toEqual([{ machine: 'door', from: 'closed', to: 'open', on: '$.data.knock', writes: 1 }]);
        expect(of('stateui-app.logic.rule').map((report) => report.details)).toEqual([{ rule: 'copyName', on: '$.data.name', writes: 1 }]);
        // the table and the compute also ran once at start, deriving from no data
        expect(of('stateui-app.logic.table').at(-1)?.details).toEqual({ table: 'size', records: 1, writes: 1, ms: expect.any(Number) });
        expect(of('stateui-app.logic.compute').at(-1)?.details).toEqual({ compute: 'double', records: 1, writes: 1, ms: expect.any(Number) });
        expect(of('stateui-app.logic.effect').map((report) => report.message)).toEqual(['Effect started', 'Effect finished']);
        expect(of('stateui-app.logic.effect')[1]?.details).toEqual({ effect: 'fetch', run: '$.functions.host.fetch', ms: expect.any(Number) });
        expect(memory.get('$.data.answer')).toBe(SECRET);
        expect(JSON.stringify(seen)).not.toContain(SECRET);
    });

    it('should report nothing while its categories are off', () => {
        // Arrange
        setCategories(['info', 'error', 'stack']);

        // Act
        assembleApp(STORE_APP, STORE_PARTS, { library: STORE_LIBRARY });

        // Assert
        expect(seen).toEqual([]);
    });
});
