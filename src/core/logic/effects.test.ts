import { describe, expect, it } from 'vitest';
import { cloneJson, isObject } from '../resolve/merge.js';
import type { JsonObject, JsonValue } from '../types.js';
import { canonicalJson, requestToken } from './effects.js';
import { createLogicEngine, logicRunOrder, readLogic } from './index.js';
import type { LogicDocument, LogicEffectAnswer, LogicEffectFunction, LogicFailure, LogicHost, LogicWrite } from './index.js';

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
    const commits: LogicWrite[][] = [];
    const failures: LogicFailure[] = [];
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
            commits.push(writes.map((write) => ({ ...write })));
            for (const write of writes) apply(write);
        },
        failed: (failure) => failures.push(failure),
        ...overrides
    };
    return { host, commits, failures, get: (path: string) => walk(root, path), apply };
}

/** A fake effect whose answers the test releases: each call waits until `answer` or `fail` is called for it */
function fakeEffect() {
    const calls: { request: JsonValue; signal: AbortSignal; resolve(answer: LogicEffectAnswer): void; reject(error: Error): void }[] = [];
    const run: LogicEffectFunction = (request, { signal }) =>
        new Promise((resolve, reject) => {
            calls.push({ request, signal, resolve, reject });
        });
    return { run, calls };
}

const flush = async (): Promise<void> => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

/** A user change applied to the state, then looked up */
function change(memory: ReturnType<typeof stateHost>, engine: ReturnType<typeof createLogicEngine>, path: string, value: JsonValue | undefined): void {
    const previous = memory.get(path);
    memory.apply(value === undefined ? { path } : { path, value });
    engine.changes([{ path, ...(value === undefined ? {} : { value }), ...(previous === undefined ? {} : { previous }) }]);
}

const ORDERS: LogicDocument = Object.freeze({
    effects: {
        fetchOrders: {
            request: '$.data.orders.request',
            run: 'orders.fetch',
            status: '$.data.orders.status',
            records: { into: '$.data.orders.records', key: 'id' },
            window: '$.screens.main.grid',
            cache: 2
        }
    }
}) as LogicDocument;

const page = (first: number, ids: string[], total = 100): LogicEffectAnswer => ({ first, total, records: ids.map((id) => ({ id, name: `Order ${id}` })) });

describe('request tokens', () => {
    it('should give equal requests the same token whatever their key order', () => {
        expect(canonicalJson({ b: [1, { d: 1, c: 2 }], a: 'x' })).toBe('{"a":"x","b":[1,{"c":2,"d":1}]}');
        expect(requestToken({ first: 0, count: 50 })).toBe(requestToken({ count: 50, first: 0 }));
        expect(requestToken({ first: 0, count: 50 })).not.toBe(requestToken({ first: 50, count: 50 }));
    });
});

describe('createLogicEngine: effects', () => {
    it('should start on a request and commit the records, the window and the status together', async () => {
        // Arrange
        const fake = fakeEffect();
        const memory = stateHost({ data: { orders: {} }, screens: { main: { grid: { key: 'ref' } } } }, { functions: { effects: { 'orders.fetch': fake.run } } });
        const engine = createLogicEngine(ORDERS, memory.host);
        engine.start();

        // Act
        change(memory, engine, '$.data.orders.request', { first: 0, count: 2 });
        await flush();

        // Assert: loading while the call runs
        const token = requestToken({ first: 0, count: 2 });
        expect(fake.calls.map((call) => call.request)).toEqual([{ first: 0, count: 2 }]);
        expect(memory.get('$.data.orders.status')).toEqual({ token, state: 'loading', at: expect.any(String) });
        expect(engine.effects()).toEqual([{ name: 'fetchOrders', token, running: true, cached: 0 }]);
        const before = memory.commits.length;

        // Act
        fake.calls[0]?.resolve(page(0, ['o1', 'o2']));
        await flush();

        // Assert
        expect(memory.commits.length).toBe(before + 1);
        expect(memory.get('$.data.orders.records')).toEqual({ o1: { id: 'o1', name: 'Order o1' }, o2: { id: 'o2', name: 'Order o2' } });
        expect(memory.get('$.screens.main.grid')).toEqual({
            key: 'ref',
            records: { 0: { id: 'o1', name: 'Order o1', ref: 'o1' }, 1: { id: 'o2', name: 'Order o2', ref: 'o2' } },
            total: 100
        });
        expect(memory.get('$.data.orders.status')).toEqual({ token, state: 'ready', total: 100, at: expect.any(String) });
        expect(engine.effects()).toEqual([{ name: 'fetchOrders', token, running: false, cached: 1 }]);
        expect(engine.trace().at(-1)).toEqual(expect.objectContaining({ cause: 'effect', changes: ['fetchOrders answered'] }));
    });

    it('should abort the running call for a new request and drop its late answer', async () => {
        // Arrange
        const fake = fakeEffect();
        const memory = stateHost({ data: { orders: {} }, screens: { main: { grid: {} } } }, { functions: { effects: { 'orders.fetch': fake.run } } });
        const engine = createLogicEngine(ORDERS, memory.host);
        engine.start();
        change(memory, engine, '$.data.orders.request', { first: 0 });
        await flush();

        // Act
        change(memory, engine, '$.data.orders.request', { first: 2 });
        await flush();
        fake.calls[1]?.resolve(page(2, ['o3']));
        await flush();
        fake.calls[0]?.resolve(page(0, ['o1', 'o2']));
        await flush();

        // Assert
        expect(fake.calls.map((call) => call.signal.aborted)).toEqual([true, false]);
        expect(memory.get('$.screens.main.grid.records')).toEqual({ 2: { id: 'o3', name: 'Order o3' } });
        expect(Object.keys(memory.get('$.data.orders.records') as JsonObject)).toEqual(['o3']);
        expect(memory.get('$.data.orders.status.token')).toBe(requestToken({ first: 2 }));
    });

    it('should refill the window from the records for a cached token, with no call', async () => {
        // Arrange
        const fake = fakeEffect();
        const memory = stateHost({ data: { orders: {} }, screens: { main: { grid: {} } } }, { functions: { effects: { 'orders.fetch': fake.run } } });
        const engine = createLogicEngine(ORDERS, memory.host);
        engine.start();
        change(memory, engine, '$.data.orders.request', { first: 0 });
        await flush();
        fake.calls[0]?.resolve(page(0, ['o1', 'o2'], 4));
        await flush();
        change(memory, engine, '$.data.orders.request', { first: 2 });
        await flush();
        fake.calls[1]?.resolve(page(2, ['o3', 'o4'], 4));
        await flush();

        // Act
        change(memory, engine, '$.data.orders.request', { first: 0 });
        await flush();

        // Assert
        expect(fake.calls).toHaveLength(2);
        expect(memory.get('$.screens.main.grid')).toEqual({ records: { 0: { id: 'o1', name: 'Order o1' }, 1: { id: 'o2', name: 'Order o2' } }, total: 4 });
        expect(memory.get('$.data.orders.status')).toEqual({ token: requestToken({ first: 0 }), state: 'ready', total: 4, at: expect.any(String) });
        expect(Object.keys(memory.get('$.data.orders.records') as JsonObject)).toEqual(['o1', 'o2', 'o3', 'o4']);
    });

    it('should keep at most `cache` answers', async () => {
        // Arrange
        const fake = fakeEffect();
        const memory = stateHost({ data: { orders: {} }, screens: { main: { grid: {} } } }, { functions: { effects: { 'orders.fetch': fake.run } } });
        const engine = createLogicEngine(ORDERS, memory.host);
        engine.start();

        // Act: three pages with a cache of two, then back to the first
        for (const [index, first] of [0, 2, 4].entries()) {
            change(memory, engine, '$.data.orders.request', { first });
            await flush();
            fake.calls[index]?.resolve(page(first, [`o${first}`]));
            await flush();
        }
        change(memory, engine, '$.data.orders.request', { first: 0 });
        await flush();

        // Assert
        expect(fake.calls).toHaveLength(4);
        expect(engine.effects()[0]?.cached).toBe(2);
    });

    it('should rewrite the window rows that hold an edited record', async () => {
        // Arrange
        const fake = fakeEffect();
        const memory = stateHost({ data: { orders: {} }, screens: { main: { grid: {} } } }, { functions: { effects: { 'orders.fetch': fake.run } } });
        const engine = createLogicEngine(ORDERS, memory.host);
        engine.start();
        change(memory, engine, '$.data.orders.request', { first: 0 });
        await flush();
        fake.calls[0]?.resolve(page(0, ['o1', 'o2']));
        await flush();
        const before = memory.commits.length;

        // Act
        change(memory, engine, '$.data.orders.records.o2.name', 'Renamed');

        // Assert
        expect(memory.get('$.screens.main.grid.records.1')).toEqual({ id: 'o2', name: 'Renamed' });
        expect(memory.commits.slice(before)).toEqual([[{ path: '$.screens.main.grid.records.1', value: { id: 'o2', name: 'Renamed' } }]]);
        expect(fake.calls).toHaveLength(1);
    });

    it('should write the error of a call that fails', async () => {
        // Arrange
        const fake = fakeEffect();
        const memory = stateHost({ data: { orders: {} } }, { functions: { effects: { 'orders.fetch': fake.run } } });
        const engine = createLogicEngine(ORDERS, memory.host);
        engine.start();
        change(memory, engine, '$.data.orders.request', { first: 0 });
        await flush();

        // Act
        fake.calls[0]?.reject(new Error('the API is down'));
        await flush();

        // Assert
        expect(memory.get('$.data.orders.status')).toEqual({ token: requestToken({ first: 0 }), state: 'error', reason: 'the API is down', at: expect.any(String) });
        expect(memory.failures).toEqual([]);
    });

    it('should write an error when the host refuses the answer', async () => {
        // Arrange
        const fake = fakeEffect();
        const memory = stateHost({ data: { orders: { request: { first: 0 } } } }, { functions: { effects: { 'orders.fetch': fake.run } } });
        const commit = memory.host.commit;
        memory.host.commit = (writes) => {
            if (writes.some((write) => write.path.startsWith('$.data.orders.records'))) throw new Error('no room');
            commit(writes);
        };
        createLogicEngine(ORDERS, memory.host).start();
        await flush();

        // Act
        fake.calls[0]?.resolve(page(0, ['o1']));
        await flush();

        // Assert
        expect(memory.get('$.data.orders.status')).toEqual(expect.objectContaining({ state: 'error', reason: 'the answer could not be written: no room' }));
        expect(memory.failures).toEqual([{ kind: 'effect', name: 'fetchOrders', reason: 'no room' }]);
    });

    it('should ask the host when no function is registered, and fail without one', async () => {
        // Arrange
        const asked: unknown[] = [];
        const answering = stateHost(
            { data: { orders: { request: { first: 0 } } } },
            {
                effect: (request) => {
                    asked.push(request);
                    return Promise.resolve({ value: 'done' });
                }
            }
        );
        const failing = stateHost({ data: { orders: { request: { first: 0 } } } });

        // Act
        createLogicEngine(ORDERS, answering.host).start();
        createLogicEngine(ORDERS, failing.host).start();
        await flush();

        // Assert
        const token = requestToken({ first: 0 });
        expect(asked).toEqual([{ name: 'fetchOrders', run: 'orders.fetch', token, request: { first: 0 } }]);
        expect(answering.get('$.data.orders.status.state')).toBe('ready');
        expect(failing.failures).toEqual([{ kind: 'effect', name: 'fetchOrders', reason: 'the host registered no effect function "orders.fetch"' }]);
        expect(failing.get('$.data.orders.status')).toEqual(expect.objectContaining({ token, state: 'error' }));
    });

    it('should keep an answer already in state at start, and go idle when the request goes', async () => {
        // Arrange
        const fake = fakeEffect();
        const token = requestToken({ first: 0 });
        const memory = stateHost(
            { data: { orders: { request: { first: 0 }, status: { token, state: 'ready', at: '2026-01-01T00:00:00.000Z' } } } },
            { functions: { effects: { 'orders.fetch': fake.run } } }
        );
        const engine = createLogicEngine(ORDERS, memory.host);

        // Act
        engine.start();
        await flush();
        change(memory, engine, '$.data.orders.request', undefined);

        // Assert
        expect(fake.calls).toEqual([]);
        expect(memory.get('$.data.orders.status')).toEqual({ state: 'idle', at: expect.any(String) });
    });

    it('should start once for a request a rule writes, after its chain', async () => {
        // Arrange
        const fake = fakeEffect();
        const logic: LogicDocument = {
            ...ORDERS,
            rules: {
                ask: { when: { path: '$.screens.main.grid.window' }, do: [{ command: 'set', target: '$.data.orders.request', value: { first: '{{ $trigger.first }}', count: 2 } }] }
            }
        };
        const memory = stateHost({ data: { orders: {} }, screens: { main: { grid: {} } } }, { functions: { effects: { 'orders.fetch': fake.run } } });
        const engine = createLogicEngine(logic, memory.host);
        engine.start();

        // Act
        change(memory, engine, '$.screens.main.grid.window', { first: 4, count: 2 });
        await flush();

        // Assert
        expect(fake.calls.map((call) => call.request)).toEqual([{ first: 4, count: 2 }]);
        expect(engine.names).toEqual(['ask', 'fetchOrders']);
    });

    it('should drop answers after stop', async () => {
        // Arrange
        const fake = fakeEffect();
        const memory = stateHost({ data: { orders: { request: { first: 0 } } } }, { functions: { effects: { 'orders.fetch': fake.run } } });
        const engine = createLogicEngine(ORDERS, memory.host);
        engine.start();
        await flush();

        // Act
        engine.stop();
        fake.calls[0]?.resolve(page(0, ['o1']));
        await flush();

        // Assert
        expect(fake.calls[0]?.signal.aborted).toBe(true);
        expect(memory.get('$.data.orders.records')).toBeUndefined();
    });
});

describe('readLogic: effects', () => {
    it('should read an effect, list it in the run order and warn about an unknown function', () => {
        // Act
        const known = readLogic(ORDERS as unknown as JsonValue, { functions: { effects: { 'orders.fetch': () => Promise.resolve({}) } } });
        const unknown = readLogic(ORDERS as unknown as JsonValue, { functions: {} });

        // Assert
        expect(known.errors).toEqual([]);
        expect(Object.keys(known.logic.effects ?? {})).toEqual(['fetchOrders']);
        expect(unknown.errors.map((error) => [error.code, error.severity, error.statePath])).toEqual([['SUI-LOGIC-FUNCTION', 'warning', '$.logic.effects.fetchOrders.run']]);
        expect(logicRunOrder(ORDERS)).toEqual([
            { kind: 'effect', name: 'fetchOrders', reads: ['$.data.orders.request'], writes: ['$.data.orders.status', '$.data.orders.records', '$.screens.main.grid'] }
        ]);
    });

    it('should refuse captures, records outside data, a bad cache and a cache without records', () => {
        // Arrange
        const logic = {
            effects: {
                a: { request: '$.data.{id}.request', run: 'f', status: '$.data.s', records: { into: '$.app.x', key: 'id' }, cache: 1.5 },
                b: { request: '$.data.r', run: 'f', status: '$.data.s', cache: 3, extra: 1 }
            }
        } as unknown as JsonValue;

        // Act
        const result = readLogic(logic);

        // Assert
        expect(result.errors.map((error) => error.statePath)).toEqual(
            expect.arrayContaining([
                '$.logic.effects.a.request',
                '$.logic.effects.a.records.into',
                '$.logic.effects.a.cache',
                '$.logic.effects.b.cache',
                '$.logic.effects.b.extra'
            ])
        );
        expect(result.logic.effects).toBeUndefined();
    });
});
