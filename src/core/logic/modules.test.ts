import { describe, expect, it } from 'vitest';
import type { LogicModule } from '../blueprint/types.js';
import type { BuildError } from '../errors/index.js';
import { cloneJson, isObject } from '../resolve/merge.js';
import type { JsonObject, JsonValue } from '../types.js';
import { createLogicEngine } from './engine.js';
import { instantiateModule, readModule } from './modules.js';
import type { LogicDocument, LogicFailure, LogicHost, LogicWrite } from './types.js';

/** The cart module of the design: totals over the bag lines, with a tax rate and a currency as params */
const CART = Object.freeze({
    needs: { bag: { model: 'bag-line' }, totals: { model: 'cart-totals' } },
    params: {
        rate: { type: 'number', default: 0.2, validators: { range: { min: 0, max: 1 } } },
        currency: { type: 'string', required: true, validators: { oneOf: ['EUR', 'USD', 'GBP'] } },
        label: { type: 'string', default: 'Total' }
    },
    rules: {
        totals: {
            when: { path: '$.data.bag' },
            do: [
                { command: 'set', target: '$.data.totals.net', value: "{{ sum($.data.bag, 'line') }}" },
                { command: 'set', target: '$.data.totals.gross', value: "{{ round(sum($.data.bag, 'line') * (1 + $params.rate) * 100) / 100 }}" },
                { command: 'set', target: '$.data.totals.currency', value: '$params.currency' },
                { command: 'set', target: '$.data.totals.label', value: '{{ $params.label + " (" + $params.currency + ")" }}' }
            ]
        },
        big: { when: { path: '$.data.totals.net', if: '$.data.totals.net > 100 && $params.currency == "EUR"' }, do: [{ command: 'set', target: '$.data.totals.big', value: true }] }
    }
}) as unknown as JsonObject;

const messages = (errors: BuildError[]): string[] => errors.map((error) => `${error.code} ${error.message}`);
const copy = (value: JsonObject): JsonObject => cloneJson(value) as JsonObject;

function read(json: JsonObject): LogicModule {
    const result = readModule(json);
    expect(result.errors).toEqual([]);
    return result.module as LogicModule;
}

function walk(state: JsonValue, path: string): JsonValue | undefined {
    let current: JsonValue | undefined = state;
    for (const step of path.slice(2).split('.')) {
        if (!isObject(current)) return undefined;
        current = current[step];
    }
    return current;
}

/** A host over plain JSON state; `change` applies a person's write and hands it to the engine */
function run(logic: LogicDocument, initial: JsonObject) {
    const state = cloneJson(initial) as JsonObject;
    const failures: LogicFailure[] = [];
    const apply = (write: LogicWrite): void => {
        const steps = write.path.slice(2).split('.');
        let current = state;
        for (const step of steps.slice(0, -1)) {
            if (!isObject(current[step])) current[step] = {};
            current = current[step] as JsonObject;
        }
        current[steps[steps.length - 1] as string] = cloneJson(write.value as JsonValue);
    };
    const host: LogicHost = {
        get: (path) => walk(state, path),
        commit: (writes) => writes.forEach(apply),
        failed: (failure) => failures.push(failure)
    };
    const engine = createLogicEngine(logic, host);
    return {
        failures,
        get: (path: string) => walk(state, path),
        change(path: string, value: JsonValue): void {
            const previous = walk(state, path);
            apply({ path, value });
            engine.changes([previous === undefined ? { path, value } : { path, value, previous }]);
        }
    };
}

/** The app's own table: each bag line's total from its quantity and price */
const LINE_TABLE: LogicDocument = Object.freeze({
    tables: {
        line: {
            inputs: { qty: '$.data.bag.{id}.qty', price: '$.data.bag.{id}.price' },
            outputs: { line: '$.data.bag.{id}.line' },
            rows: [{ line: '{{ $qty * $price }}' }]
        }
    }
}) as LogicDocument;

const BAG = Object.freeze({ data: { bag: { a: { qty: 1, price: 50, line: 50 }, b: { qty: 1, price: 20, line: 20 } }, totals: {} } }) as unknown as JsonObject;

describe('readModule', () => {
    it('should read a module with needs, typed params and units', () => {
        // Act
        const result = readModule(copy(CART));

        // Assert
        expect(result.errors).toEqual([]);
        expect(Object.keys(result.module?.rules ?? {})).toEqual(['totals', 'big']);
    });

    it('should report the unit errors of readLogic under the module root', () => {
        // Arrange
        const json = { ...copy(CART), rules: { broken: { when: { path: '$.data.bag' }, do: [{ command: 'shout', target: '$.data.totals.x' }] } } };

        // Act
        const result = readModule(json);

        // Assert
        expect(result.module).toBeUndefined();
        expect(messages(result.errors)).toEqual(['SUI-LOGIC-COMMAND Unknown logic command "shout" at $.rules.broken.do.0']);
    });

    it('should refuse missing needs and params, a need without a model and a param that is not a typed declaration', () => {
        // Act
        const missing = readModule({ rules: {} });
        const bad = readModule({ needs: { bag: {}, 'bag-lines': { model: 'bag-line' } }, params: { rate: { type: 'percent' } }, title: 'Cart' });

        // Assert
        expect(missing.errors.map((error) => error.message.split(':')[0])).toEqual(['Logic at $.needs is not valid', 'Logic at $.params is not valid']);
        expect(bad.errors.map((error) => error.message)).toEqual([
            'Logic at $.title is not valid: unknown key "title"',
            'Logic at $.needs.bag.model is not valid: "model" must be the name of a model part',
            'Logic at $.needs.bag-lines is not valid: need name "bag-lines" must be a key name',
            'Logic at $.params.rate.type is not valid: type must be one of string, number, integer, boolean, array, object, any, url'
        ]);
    });

    it('should refuse a module that names a node, a screen or navigates', () => {
        // Arrange
        const json = {
            ...copy(CART),
            rules: {
                shell: { when: { path: '$.data.bag' }, do: [{ command: 'set', target: '$.app.children.total.value', value: 1 }] },
                screen: { when: { path: '$.data.bag' }, do: [{ command: 'set', target: '$.data.totals.x', value: '{{ $.screens.cart.root.title }}' }] },
                reference: { when: { path: '$.data.bag' }, do: [{ command: 'set', target: '^total.value', value: 1 }] },
                away: { when: { path: '$.data.bag' }, do: [{ command: 'navigate', target: 'home' }] }
            }
        };

        // Act
        const errors = readModule(json).errors;

        // Assert
        expect(errors.map((error) => error.code)).toEqual(['SUI-MODULE-NODE', 'SUI-MODULE-NODE', 'SUI-MODULE-NODE', 'SUI-MODULE-NODE']);
        expect(errors[0]?.message).toBe('The logic module names a node or screen at $.rules.shell.do.0.target ($.app); a module works on the data it needs only');
        expect(errors.map((error) => error.statePath)).toEqual([
            '$.rules.shell.do.0.target',
            '$.rules.screen.do.0.value',
            '$.rules.reference.do.0.target',
            '$.rules.away.do.0'
        ]);
    });

    it('should refuse a $.data path outside the needs, and $params of an undeclared param', () => {
        // Arrange
        const json = {
            ...copy(CART),
            rules: {
                orders: { when: { path: '$.data.orders' }, do: [{ command: 'set', target: '$.data.totals.n', value: '{{ count($.data.orders) + $params.discount }}' }] },
                any: { when: { path: '$.data.{list}' }, do: [{ command: 'set', target: '$.data.totals.n', value: 1 }] }
            }
        };

        // Act
        const errors = readModule(json).errors;

        // Assert
        expect(messages(errors)).toEqual([
            'SUI-MODULE-NEEDS The logic module reaches $.data.orders at $.rules.orders.when.path, which is not in its needs; declared: bag, totals',
            'SUI-MODULE-NEEDS The logic module reaches $.data.orders at $.rules.orders.do.0.value, which is not in its needs; declared: bag, totals',
            'SUI-MODULE-PARAM Param "discount" of the logic module at $.rules.orders.do.0.value: the module declares no such param',
            'SUI-MODULE-NEEDS The logic module reaches $.data.{list} at $.rules.any.when.path, which is not in its needs; declared: bag, totals'
        ]);
    });

    it('should warn on increment and on save-data without a key, and keep the module', () => {
        // Arrange
        const json = {
            ...copy(CART),
            rules: {
                count: { when: { path: '$.data.bag' }, do: [{ command: 'increment', target: '$.data.totals.changes' }] },
                log: { when: { path: '$.data.bag' }, do: [{ command: 'save-data', into: '$.data.totals', value: { at: '{{ today() }}' } }] },
                keyed: { when: { path: '$.data.bag' }, do: [{ command: 'save-data', into: '$.data.totals', key: 'last', value: { at: '{{ today() }}' } }] }
            }
        };

        // Act
        const result = readModule(json);

        // Assert
        expect(result.module).toBeDefined();
        expect(result.errors.map((error) => [error.code, error.severity, error.statePath])).toEqual([
            ['SUI-MODULE-ONCE', 'warning', '$.rules.count.do.0'],
            ['SUI-MODULE-ONCE', 'warning', '$.rules.log.do.0']
        ]);
    });
});

describe('instantiateModule', () => {
    it('should fill each $params with its value, prefix the unit names and leave the module alone', () => {
        // Arrange
        const module = read(copy(CART));
        const before = JSON.stringify(module);

        // Act
        const result = instantiateModule(module, { currency: 'EUR', rate: 0.1 }, { name: 'cart' });

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.params).toEqual({ rate: 0.1, currency: 'EUR', label: 'Total' });
        expect(Object.keys(result.logic.rules ?? {})).toEqual(['cart:totals', 'cart:big']);
        const commands = result.logic.rules?.['cart:totals']?.do ?? [];
        expect(commands[1]?.value).toBe("{{ round(sum($.data.bag, 'line') * (1 + 0.1) * 100) / 100 }}");
        expect(commands[2]?.value).toBe('EUR');
        expect(result.logic.rules?.['cart:big']?.when.if).toBe('$.data.totals.net > 100 && "EUR" == "EUR"');
        expect(JSON.stringify(module)).toBe(before);
    });

    it('should JSON-escape a string param with a quote and a backslash, so the expression gives it back unchanged', () => {
        // Arrange
        const label = 'Sum "net" \\ gross';
        const instance = instantiateModule(read(copy(CART)), { currency: 'USD', label }, { name: 'cart' });
        const engine = run(instance.logic, BAG);

        // Act
        engine.change('$.data.bag.c', { qty: 1, price: 1, line: 1 });

        // Assert
        expect(instance.errors).toEqual([]);
        expect(engine.get('$.data.totals.label')).toBe(`${label} (USD)`);
        expect(engine.failures).toEqual([]);
    });

    it('should report a missing required param, a value that does not fit and a value for an undeclared param', () => {
        // Act
        const missing = instantiateModule(read(copy(CART)), {}, { name: 'cart' });
        const misfits = instantiateModule(read(copy(CART)), { currency: 'CHF', rate: 2, discount: 5 }, { name: 'cart' });

        // Assert
        expect(missing.logic).toEqual({});
        expect(messages(missing.errors)).toEqual(['SUI-MODULE-PARAM Param "currency" of the logic module at params.currency: it is required and has no value']);
        expect(misfits.errors.map((error) => error.message)).toEqual([
            'Param "discount" of the logic module at params.discount: the module declares no such param',
            'Param "rate" of the logic module at params.rate: the value fails its validators',
            'Param "currency" of the logic module at params.currency: the value fails its validators'
        ]);
    });

    it('should put an array or object param in as a whole value and refuse it inside an expression', () => {
        // Arrange
        const module = read({
            needs: { totals: { model: 'cart-totals' } },
            params: { tiers: { type: 'array', default: [10, 20] } },
            rules: {
                whole: { when: { path: '$.data.totals.net' }, do: [{ command: 'set', target: '$.data.totals.tiers', value: '$params.tiers' }] }
            }
        });
        const inside = read({
            needs: { totals: { model: 'cart-totals' } },
            params: { tiers: { type: 'array', default: [10, 20] } },
            rules: { inside: { when: { path: '$.data.totals.net' }, do: [{ command: 'set', target: '$.data.totals.n', value: '{{ count($params.tiers) }}' }] } }
        });

        // Act
        const ok = instantiateModule(module, {}, { name: 'tiers' });
        const refused = instantiateModule(inside, {}, { name: 'tiers' });

        // Assert
        expect(ok.logic.rules?.['tiers:whole']?.do[0]?.value).toEqual([10, 20]);
        expect(refused.errors.map((error) => error.code)).toEqual(['SUI-MODULE-PARAM']);
    });

    it('should prefix the as names and the result triggers that wait for them', () => {
        // Arrange
        const module = read({
            needs: { totals: { model: 'cart-totals' } },
            params: {},
            rules: {
                save: { when: { path: '$.data.totals.net' }, do: [{ command: 'save-data', into: '$.data.totals', key: 'snapshot', value: { net: 1 }, as: 'saved' }] },
                after: { when: { result: 'saved', is: 'accepted' }, do: [{ command: 'set', target: '$.data.totals.saved', value: true }] }
            }
        });

        // Act
        const logic = instantiateModule(module, {}, { name: 'cart' }).logic;

        // Assert
        expect(logic.rules?.['cart:save']?.do[0]?.as).toBe('cart:saved');
        expect(logic.rules?.['cart:after']?.when.result).toBe('cart:saved');
    });
});

describe('module units in the run order', () => {
    it('should run a module rule after an app table that writes under its trigger, in the same step', () => {
        // Arrange
        const instance = instantiateModule(read(copy(CART)), { currency: 'EUR' }, { name: 'cart' });
        const engine = run({ ...instance.logic, ...LINE_TABLE }, BAG);

        // Act
        engine.change('$.data.bag.a.qty', 3);

        // Assert
        expect(engine.get('$.data.bag.a.line')).toBe(150);
        expect(engine.get('$.data.totals.net')).toBe(170);
        expect(engine.get('$.data.totals.gross')).toBe(204);
        expect(engine.get('$.data.totals.big')).toBe(true);
        expect(engine.failures).toEqual([]);
    });

    it('should give two apps with different params different totals over the same lines', () => {
        // Arrange
        const module = read(copy(CART));
        const eu = run({ ...instantiateModule(module, { currency: 'EUR', rate: 0.2 }, { name: 'cart' }).logic, ...LINE_TABLE }, BAG);
        const us = run({ ...instantiateModule(module, { currency: 'USD', rate: 0.05 }, { name: 'cart' }).logic, ...LINE_TABLE }, BAG);

        // Act
        eu.change('$.data.bag.b.qty', 2);
        us.change('$.data.bag.b.qty', 2);

        // Assert
        expect([eu.get('$.data.totals.net'), us.get('$.data.totals.net')]).toEqual([90, 90]);
        expect([eu.get('$.data.totals.gross'), us.get('$.data.totals.gross')]).toEqual([108, 94.5]);
        expect([eu.get('$.data.totals.currency'), us.get('$.data.totals.currency')]).toEqual(['EUR', 'USD']);
    });
});
