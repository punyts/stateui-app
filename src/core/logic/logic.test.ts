import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveNode } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { cloneJson, isObject } from '../resolve/merge.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import { validateDocument } from '../validate/index.js';
import {
    WorkingCopy,
    compilePattern,
    createLogicEngine,
    createLogicIndex,
    evaluate,
    matchPattern,
    readLogic,
    resolveValue
} from './index.js';
import type { LogicComputeFunction, LogicDocument, LogicFailure, LogicHost, LogicWrite } from './index.js';

function shapeOf(properties: Record<string, unknown>, events: string[] = [], commands: string[] = []): Shape {
    const result = parseShape({ summary: 'Test', properties, events, commands }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const LIBRARY: ComponentLibrary = Object.freeze({
    page: { tier: 'root', tag: 'ui-page', shape: shapeOf({ _title: { type: 'string', kind: 'content', default: '' } }) },
    modal: {
        tier: 'root',
        tag: 'ui-modal',
        shape: shapeOf(
            {
                open: { type: 'boolean', default: false },
                phase: { type: 'string' },
                saved: { type: 'boolean', default: false },
                error: { type: 'string', default: '' },
                body: { type: 'node' }
            },
            ['close'],
            ['open', 'close']
        )
    },
    form: {
        tier: 'root',
        tag: 'ui-form',
        shape: shapeOf({ status: { type: 'string', default: 'pristine', runtime: true } }, ['submitted'], ['submit'])
    },
    textField: {
        tier: 'root',
        tag: 'ui-text-field',
        shape: shapeOf({ value: { type: 'string', default: '' }, _label: { type: 'string', kind: 'content', default: '' } })
    },
    checkField: { tier: 'root', tag: 'ui-check-field', shape: shapeOf({ checked: { type: 'boolean', default: false } }) },
    recordList: {
        tier: 'root',
        tag: 'ui-record-list',
        shape: shapeOf({ key: { type: 'string', default: 'id' }, records: { type: ['array', 'object'] }, total: { type: 'integer' }, window: { type: 'object' } })
    },
    stat: { tier: 'root', tag: 'ui-stat', shape: shapeOf({ value: { type: 'string', default: '' } }) }
});

const APP: Node = Object.freeze({
    component: 'page',
    children: {
        addContact: {
            component: 'modal',
            body: {
                component: 'form',
                children: {
                    name: { component: 'textField', _label: 'Name' },
                    vip: { component: 'checkField' }
                }
            }
        },
        contacts: { component: 'recordList' }
    }
}) as Node;

const ADD_CONTACT: LogicDocument = Object.freeze({
    machines: {
        addContact: {
            state: '$.app.children.addContact.phase',
            initial: 'editing',
            transitions: [
                {
                    from: 'editing',
                    when: { path: '$.app.children.addContact.saved', is: true },
                    do: [
                        { command: 'set', target: '$.app.children.addContact.saved', value: false },
                        { command: 'save-data', into: '$.data.contacts', value: { form: '^addContact.body' }, as: 'save' }
                    ],
                    to: 'saving'
                },
                {
                    from: 'saving',
                    when: { result: 'save', is: 'accepted' },
                    do: [
                        { command: 'reset', target: '^addContact.body' },
                        { command: 'set', target: '^addContact.open', value: false },
                        { command: 'notify', target: 'toast', value: { text: 'Added {{ $result.key }}' } }
                    ],
                    to: 'editing'
                },
                {
                    from: 'saving',
                    when: { result: 'save', is: 'rejected' },
                    do: [{ command: 'set', target: '^addContact.error', value: '{{ $result.reason }}' }],
                    to: 'editing'
                }
            ]
        }
    },
    rules: {
        contactCount: {
            when: { path: '$.data.contacts' },
            do: [{ command: 'set', target: '$.data.stats.contacts', value: '{{ size($.data.contacts) }}' }]
        }
    }
}) as LogicDocument;

function walk(state: JsonValue, path: string): JsonValue | undefined {
    let current: JsonValue | undefined = state;
    for (const step of path === '$' ? [] : path.slice(2).split('.')) {
        if (!isObject(current) && !Array.isArray(current)) return undefined;
        current = (current as Record<string, JsonValue>)[step];
    }
    return current;
}

/** A host over a plain JSON state, with the document index for references, fields and reset */
function memoryHost(initial: JsonObject, overrides: Partial<LogicHost> = {}) {
    const state = { root: cloneJson(initial) as JsonValue };
    const commits: LogicWrite[][] = [];
    const failures: LogicFailure[] = [];
    const notices: [string, JsonValue][] = [];
    const emits: [string, JsonValue][] = [];
    const resolved = resolveNode(APP, LIBRARY, {});
    const index = createLogicIndex(resolved, LIBRARY, initial['data']);
    let next = 0;
    const apply = (write: LogicWrite): void => {
        const steps = write.path.slice(2).split('.');
        let current = state.root as JsonObject;
        for (const step of steps.slice(0, -1)) {
            if (!isObject(current[step])) current[step] = {};
            current = current[step] as JsonObject;
        }
        const last = steps[steps.length - 1] as string;
        if (write.value === undefined) delete current[last];
        else current[last] = cloneJson(write.value);
    };
    const host: LogicHost = {
        get: (path) => walk(state.root, path),
        commit: (writes) => {
            commits.push(writes.map((write) => ({ ...write })));
            for (const write of writes) apply(write);
        },
        resolve: index.resolve,
        fields: index.fields,
        initial: (path) => {
            const value = index.initial(path);
            return value;
        },
        notify: (name, payload) => notices.push([name, payload]),
        emit: (name, payload) => emits.push([name, payload]),
        failed: (failure) => failures.push(failure),
        newKey: () => `c${(next += 1)}`,
        ...overrides
    };
    return { host, state, commits, failures, notices, emits, apply, get: (path: string) => walk(state.root, path) };
}

const BASE: JsonObject = Object.freeze({
    app: {
        component: 'page',
        children: {
            addContact: {
                component: 'modal',
                open: true,
                body: { component: 'form', children: { name: { component: 'textField', value: '' }, vip: { component: 'checkField', checked: false } } }
            },
            contacts: { component: 'recordList' }
        }
    },
    data: { contacts: {}, stats: { contacts: 0 } }
}) as JsonObject;

/** Applies a user's change to the host's state and hands it to the engine, as a runner does */
function userChange(memory: ReturnType<typeof memoryHost>, engine: ReturnType<typeof createLogicEngine>, path: string, value: JsonValue): void {
    const previous = memory.get(path);
    memory.apply({ path, value });
    engine.changes([previous === undefined ? { path, value } : { path, value, previous }]);
}

describe('path patterns', () => {
    it('should match a change at, below and above a pattern with captures', () => {
        // Arrange
        const pattern = compilePattern('$.data.tasks.{task}.status');

        // Act
        const at = matchPattern(pattern!, '$.data.tasks.t1.status');
        const below = matchPattern(pattern!, '$.data.tasks.t1.status.code');
        const above = matchPattern(pattern!, '$.data.tasks', { t1: { status: 'open' }, t2: { status: 'done' } });

        // Assert
        expect(at).toEqual([{ path: '$.data.tasks.t1.status', captures: { task: 't1' } }]);
        expect(below).toEqual([{ path: '$.data.tasks.t1.status', captures: { task: 't1' } }]);
        expect(above.map((match) => match.captures['task'])).toEqual(['t1', 't2']);
    });

    it('should not match a change on another branch', () => {
        const pattern = compilePattern('$.app.children.*.open');

        expect(matchPattern(pattern!, '$.app.children.a.saved')).toEqual([]);
        expect(matchPattern(pattern!, '$.data.x')).toEqual([]);
    });

    it('should keep a literal step that a replaced parent removed', () => {
        const pattern = compilePattern('$.data.contacts');

        expect(matchPattern(pattern!, '$.data', {})).toEqual([{ path: '$.data.contacts', captures: {} }]);
    });

    it('should refuse patterns that are not paths', () => {
        expect(compilePattern('data.x')).toBeUndefined();
        expect(compilePattern('$.data..x')).toBeUndefined();
        expect(compilePattern('$.data.{a}.{a}')).toBeUndefined();
        expect(compilePattern('$.data.{1x}')).toBeUndefined();
    });
});

describe('WorkingCopy', () => {
    it('should lay writes over the host values in order', () => {
        // Arrange
        const base = Object.freeze({ data: Object.freeze({ a: Object.freeze({ x: 1, y: 2 }) }) }) as JsonObject;
        const copy = new WorkingCopy((path) => walk(base, path));

        // Act
        copy.set('$.data.a.x', 5);
        copy.delete('$.data.a.y');
        copy.set('$.data.b', { z: 1 });

        // Assert
        expect(copy.get('$.data.a')).toEqual({ x: 5 });
        expect(copy.get('$.data.b.z')).toBe(1);
        expect(copy.get('$.data')).toEqual({ a: { x: 5 }, b: { z: 1 } });
        expect(base).toEqual({ data: { a: { x: 1, y: 2 } } });
    });
});

describe('values', () => {
    it('should evaluate expressions over state, names and functions', () => {
        const state = { data: { items: { a: { n: 2 }, b: { n: 3 } } } } as JsonObject;
        const scope = { read: (path: string) => walk(state, path), trigger: 4, captures: { task: 't1' } };

        expect(evaluate('size($.data.items) + $trigger', scope)).toBe(6);
        expect(evaluate("sum($.data.items, 'n')", scope)).toBe(5);
        expect(evaluate('$task', scope)).toBe('t1');
        expect(evaluate('$.data.missing.x', scope)).toBeUndefined();
    });

    it('should resolve references, templates and sources', () => {
        const state = { data: { c1: { name: 'Ana' } } } as JsonObject;
        const host: LogicHost = { get: (path) => walk(state, path), commit: () => undefined };
        const scope = { read: host.get, trigger: { name: 'Bo' }, captures: { id: 'c1' } };

        expect(resolveValue('$.data.c1.name', scope, host)).toBe('Ana');
        expect(resolveValue('$trigger.name', scope, host)).toBe('Bo');
        expect(resolveValue('Hi {{ $trigger.name }}', scope, host)).toBe('Hi Bo');
        expect(resolveValue({ record: '$.data.{id}' }, scope, host)).toEqual({ name: 'Ana' });
        expect(resolveValue({ pick: { who: '$.data.c1.name', n: 1 } }, scope, host)).toEqual({ who: 'Ana', n: 1 });
        expect(resolveValue('$5 off', scope, host)).toBe('$5 off');
    });
});

describe('values: slice and today', () => {
    const scope = Object.freeze({ read: () => undefined, trigger: 0, captures: Object.freeze({}) });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should cut a string with slice', () => {
        // Arrange
        const text = "slice('2026-11-03', 0, 7)";

        // Act
        const result = evaluate(text, scope);

        // Assert
        expect(result).toBe('2026-11');
        expect(evaluate("slice('abcdef', 2)", scope)).toBe('cdef');
        expect(evaluate("slice('abcdef', -2)", scope)).toBe('ef');
        expect(evaluate("slice('abcdef', 1, null)", scope)).toBe('bcdef');
        expect(evaluate('slice(null, 1)', scope)).toEqual([]);
    });

    it('should cut an array or the entries of a map with slice', () => {
        // Arrange
        const state = Object.freeze({ data: Object.freeze({ list: [1, 2, 3, 4], map: { a: 'x', b: 'y', c: 'z' } }) }) as unknown as JsonObject;
        const withState = { ...scope, read: (path: string) => walk(state, path) };

        // Act
        const list = evaluate('slice($.data.list, 1, 3)', withState);
        const map = evaluate('slice($.data.map, 1)', withState);

        // Assert
        expect(list).toEqual([2, 3]);
        expect(map).toEqual(['y', 'z']);
    });

    it('should give the local date with today, not the UTC one', () => {
        // Arrange: local 23:30 on 3 November is already 4 November in UTC for zones west of UTC; build the date from local parts
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 10, 3, 23, 30));

        // Act
        const result = evaluate('today()', scope);

        // Assert
        expect(result).toBe('2026-11-03');
    });

    it('should pad the month and day of today', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 0, 5, 0, 5));

        expect(evaluate('today()', scope)).toBe('2026-01-05');
    });
});

describe('createLogicIndex', () => {
    const resolved = resolveNode(APP, LIBRARY, {});
    const index = createLogicIndex(resolved, LIBRARY, { contacts: { c1: { name: 'Ana' } } });

    it('should name the property a record view takes its records in', () => {
        expect(index.records('$.app.children.contacts')).toBe('records');
        expect(index.records('$.app.children.addContact')).toBeUndefined();
    });

    it('should resolve a unique node name and the steps below it', () => {
        expect(index.resolve('^addContact')).toBe('$.app.children.addContact');
        expect(index.resolve('^addContact.body.children.name.value')).toBe('$.app.children.addContact.body.children.name.value');
        expect(index.resolve('^addContact.open')).toBe('$.app.children.addContact.open');
        expect(index.resolve('^nobody')).toBeUndefined();
    });

    it('should list the fields of a form by child key', () => {
        expect(index.fields('$.app.children.addContact.body')).toEqual({
            name: '$.app.children.addContact.body.children.name.value',
            vip: '$.app.children.addContact.body.children.vip.checked'
        });
        expect(index.fields('$.app.children.addContact')).toBeUndefined();
    });

    it('should give document values with shape defaults and without runtime properties', () => {
        expect(index.initial('$.app.children.addContact.body')).toEqual({
            component: 'form',
            children: {
                name: { component: 'textField', value: '', _label: 'Name' },
                vip: { component: 'checkField', checked: false }
            }
        });
        expect(index.initial('$.data.contacts.c1')).toEqual({ name: 'Ana' });
        expect(index.initial('$.data.none')).toBeUndefined();
    });
});

describe('createLogicEngine', () => {
    it('should write each machine initial state on start', () => {
        const memory = memoryHost(BASE);
        const engine = createLogicEngine(ADD_CONTACT, memory.host);

        engine.start();

        expect(memory.get('$.app.children.addContact.phase')).toBe('editing');
        expect(engine.names).toEqual(['addContact', 'contactCount']);
    });

    it('should save a form, follow the accepted result and update a count in chain', () => {
        // Arrange
        const memory = memoryHost(BASE);
        const engine = createLogicEngine(ADD_CONTACT, memory.host);
        engine.start();
        memory.apply({ path: '$.app.children.addContact.body.children.name.value', value: 'Ana' });

        // Act
        userChange(memory, engine, '$.app.children.addContact.saved', true);

        // Assert
        expect(memory.get('$.data.contacts')).toEqual({ c1: { name: 'Ana', vip: false } });
        expect(memory.get('$.data.stats.contacts')).toBe(1);
        expect(memory.get('$.app.children.addContact.body.children.name.value')).toBe('');
        expect(memory.get('$.app.children.addContact.open')).toBe(false);
        expect(memory.get('$.app.children.addContact.saved')).toBe(false);
        expect(memory.get('$.app.children.addContact.phase')).toBe('editing');
        expect(memory.notices).toEqual([['toast', { text: 'Added c1' }]]);
        expect(memory.failures).toEqual([]);
    });

    it('should give the result of a rule command to the rules that wait for its name', () => {
        // Arrange
        const logic: LogicDocument = {
            rules: {
                save: {
                    when: { path: '$.data.saveRequested', is: true },
                    do: [
                        { command: 'set', target: '$.data.saveRequested', value: false },
                        { command: 'save-data', into: '$.data.contacts', value: { name: 'Ana' }, as: 'saved' }
                    ]
                },
                thanks: { when: { result: 'saved', is: 'accepted' }, do: [{ command: 'set', target: '$.data.lastSaved', value: '$result.key' }] },
                sorry: { when: { result: 'saved', is: 'rejected' }, do: [{ command: 'set', target: '$.data.error', value: '$result.reason' }] }
            }
        };
        const memory = memoryHost({ ...BASE, data: { contacts: {} } });
        const engine = createLogicEngine(logic, memory.host);

        // Act
        userChange(memory, engine, '$.data.saveRequested', true);

        // Assert
        expect(readLogic(logic).errors).toEqual([]);
        expect(memory.get('$.data.lastSaved')).toBe('c1');
        expect(memory.get('$.data.error')).toBeUndefined();
        expect(memory.failures).toEqual([]);
    });

    it('should give the host guard\'s reason as the rejected result of save-data, and write nothing', () => {
        // Arrange
        const logic: LogicDocument = {
            rules: {
                save: { when: { path: '$.data.go', is: true }, do: [{ command: 'save-data', into: '$.data.contacts', key: 'c9', value: { name: 7 }, as: 'saved' }] },
                sorry: { when: { result: 'saved', is: 'rejected' }, do: [{ command: 'set', target: '$.data.error', value: '$result.reason' }] }
            }
        };
        const memory = memoryHost(
            { ...BASE, data: { contacts: {} } },
            { guard: (change) => (change.path === '$.data.contacts.c9' ? 'Field "name" of record "c9" is not a string' : undefined) }
        );
        const engine = createLogicEngine(logic, memory.host);

        // Act
        userChange(memory, engine, '$.data.go', true);

        // Assert
        expect(memory.get('$.data.error')).toBe('Field "name" of record "c9" is not a string');
        expect(memory.get('$.data.contacts')).toEqual({});
        expect(engine.guard({ path: '$.data.contacts.c9', value: { name: 7 } })).toBe('Field "name" of record "c9" is not a string');
        expect(engine.guard({ path: '$.data.other', value: 1 })).toBeUndefined();
    });

    it('should refuse a rule result name that no rule or table command has, and a guard that waits for a result', () => {
        // Arrange
        const logic = {
            machines: {
                m: { state: '$.app.m', initial: 'a', transitions: [{ when: { path: '$.data.go' }, do: [{ command: 'delete-data', target: '$.data.x', as: 'gone' }] }] }
            },
            rules: {
                waits: { when: { result: 'gone' }, do: [{ command: 'set', target: '$.data.y', value: 1 }] },
                guard: { when: { result: 'gone' }, do: [{ command: 'reject', reason: 'no' }] }
            }
        };

        // Act
        const result = readLogic(logic);

        // Assert
        expect(result.errors.map((error) => error.statePath)).toEqual(
            expect.arrayContaining(['$.logic.rules.waits.when.result', '$.logic.rules.guard.when.result'])
        );
        expect(Object.keys(result.logic.rules ?? {})).toEqual([]);
    });

    it('should commit one transition as one set of writes', () => {
        const memory = memoryHost(BASE);
        const engine = createLogicEngine(ADD_CONTACT, memory.host);
        engine.start();
        memory.commits.length = 0;

        userChange(memory, engine, '$.app.children.addContact.saved', true);

        expect(memory.commits[0]).toEqual([
            { path: '$.app.children.addContact.saved', value: false },
            { path: '$.data.contacts.c1', value: { name: '', vip: false } },
            { path: '$.app.children.addContact.phase', value: 'saving' }
        ]);
    });

    it('should follow a rejected result and keep the typed values when a guard refuses the record', () => {
        // Arrange
        const logic: LogicDocument = {
            ...ADD_CONTACT,
            rules: {
                ...ADD_CONTACT.rules,
                nameRequired: {
                    when: { path: '$.data.contacts.{id}', if: 'empty($trigger.name)' },
                    do: [{ command: 'reject', reason: 'A contact needs a name' }]
                }
            }
        };
        const memory = memoryHost(BASE);
        const engine = createLogicEngine(logic, memory.host);
        engine.start();
        memory.apply({ path: '$.app.children.addContact.body.children.vip.checked', value: true });

        // Act
        userChange(memory, engine, '$.app.children.addContact.saved', true);

        // Assert
        expect(memory.get('$.data.contacts')).toEqual({});
        expect(memory.get('$.app.children.addContact.error')).toBe('A contact needs a name');
        expect(memory.get('$.app.children.addContact.body.children.vip.checked')).toBe(true);
        expect(memory.get('$.app.children.addContact.phase')).toBe('editing');
    });

    it('should ignore a trigger its current state has no row for', () => {
        const memory = memoryHost(BASE);
        const engine = createLogicEngine(ADD_CONTACT, memory.host);
        memory.apply({ path: '$.app.children.addContact.phase', value: 'saving' });

        userChange(memory, engine, '$.app.children.addContact.saved', true);

        expect(memory.get('$.data.contacts')).toEqual({});
        expect(memory.get('$.app.children.addContact.saved')).toBe(true);
    });

    it('should commit nothing and report when a command fails', () => {
        // Arrange
        const logic: LogicDocument = {
            rules: {
                broken: {
                    when: { path: '$.data.go' },
                    do: [
                        { command: 'set', target: '$.data.first', value: 1 },
                        { command: 'copy', from: '$.data.missing', target: '$.data.second' }
                    ]
                }
            }
        };
        const memory = memoryHost(BASE);
        const engine = createLogicEngine(logic, memory.host);

        // Act
        userChange(memory, engine, '$.data.go', true);

        // Assert
        expect(memory.get('$.data.first')).toBeUndefined();
        expect(memory.failures).toEqual([{ kind: 'rule', name: 'broken', command: 1, reason: '$.data.missing has no value' }]);
    });

    it('should fire a rule at most once per chain', () => {
        const logic: LogicDocument = {
            rules: { bump: { when: { path: '$.data.n' }, do: [{ command: 'increment', target: '$.data.n' }] } }
        };
        const memory = memoryHost({ ...BASE, data: { n: 0 } });
        const engine = createLogicEngine(logic, memory.host);

        userChange(memory, engine, '$.data.n', 1);

        expect(memory.get('$.data.n')).toBe(2);
        expect(memory.failures).toEqual([]);
    });

    it('should run a table that writes under the trigger of a rule before the rule in the same step', () => {
        // Arrange
        const logic: LogicDocument = {
            rules: {
                totals: { when: { path: '$.data.bag' }, do: [{ command: 'set', target: '$.data.total', value: "{{ sum($.data.bag, 'line') }}" }] }
            },
            tables: {
                line: {
                    inputs: { qty: '$.data.bag.{id}.qty', price: '$.data.bag.{id}.price' },
                    outputs: { line: '$.data.bag.{id}.line' },
                    rows: [{ line: '{{ $qty * $price }}' }]
                }
            }
        };
        const memory = memoryHost({ ...BASE, data: { bag: { a: { qty: 1, price: 5, line: 5 }, b: { qty: 1, price: 2, line: 2 } }, total: 7 } });
        const engine = createLogicEngine(logic, memory.host);

        // Act
        userChange(memory, engine, '$.data.bag.a.qty', 3);

        // Assert
        expect(memory.get('$.data.bag.a.line')).toBe(15);
        expect(memory.get('$.data.total')).toBe(17);
        expect(memory.failures).toEqual([]);
    });

    it('should stop a chain past depth 8', () => {
        const rules: NonNullable<LogicDocument['rules']> = {};
        for (let index = 0; index < 10; index += 1) {
            rules[`step${index}`] = { when: { path: `$.data.s${index}` }, do: [{ command: 'set', target: `$.data.s${index + 1}`, value: true }] };
        }
        const memory = memoryHost(BASE);
        const engine = createLogicEngine({ rules }, memory.host);

        userChange(memory, engine, '$.data.s0', true);

        expect(memory.get('$.data.s8')).toBe(true);
        expect(memory.get('$.data.s9')).toBeUndefined();
        expect(memory.failures[0]?.reason).toBe('the chain is deeper than 8');
    });

    it('should use captures in targets', () => {
        const logic: LogicDocument = {
            rules: {
                stamp: {
                    when: { path: '$.data.tasks.{task}.done', is: true },
                    do: [{ command: 'set', target: '$.data.tasks.{task}.closedBy', value: '$task' }]
                }
            }
        };
        const memory = memoryHost({ ...BASE, data: { tasks: { t1: { done: false } } } });
        const engine = createLogicEngine(logic, memory.host);

        userChange(memory, engine, '$.data.tasks.t1.done', true);

        expect(memory.get('$.data.tasks.t1')).toEqual({ done: true, closedBy: 't1' });
    });

    it('should refuse a change with a guard and allow others', () => {
        const logic: LogicDocument = {
            rules: {
                positive: { when: { path: '$.data.qty', if: '$trigger < 0' }, do: [{ command: 'reject', reason: 'Quantity {{ $trigger }} is below zero' }] }
            }
        };
        const memory = memoryHost(BASE);
        const engine = createLogicEngine(logic, memory.host);

        expect(engine.guard({ path: '$.data.qty', value: -1 })).toBe('Quantity -1 is below zero');
        expect(engine.guard({ path: '$.data.qty', value: 2 })).toBeUndefined();
        expect(engine.guard({ path: '$.data', value: { qty: -5 } })).toBe('Quantity -5 is below zero');
    });

    it('should run the state commands', () => {
        // Arrange
        const logic: LogicDocument = {
            rules: {
                all: {
                    when: { path: '$.data.go' },
                    do: [
                        { command: 'merge', target: '$.data.profile', value: { city: 'Oslo' } },
                        { command: 'copy', from: '$.data.profile.name', target: '$.data.title' },
                        { command: 'toggle', target: '$.data.flag' },
                        { command: 'increment', target: '$.data.count', value: 5 },
                        { command: 'delete-data', target: '$.data.contacts.c9' },
                        { command: 'emit', target: 'audit', value: { who: '$.data.profile.name' } }
                    ]
                }
            }
        };
        const memory = memoryHost({ ...BASE, data: { profile: { name: 'Ana' }, contacts: { c9: { name: 'Old' } } } });
        const engine = createLogicEngine(logic, memory.host);

        // Act
        userChange(memory, engine, '$.data.go', true);

        // Assert
        expect(memory.get('$.data')).toEqual({ go: true, profile: { name: 'Ana', city: 'Oslo' }, title: 'Ana', flag: true, count: 5, contacts: {} });
        expect(memory.emits).toEqual([['audit', { who: 'Ana' }]]);
    });

    it('should pull a record into a form', () => {
        const logic: LogicDocument = {
            rules: { edit: { when: { path: '$.data.editing' }, do: [{ command: 'pull-data', from: '$.data.contacts.{{ $trigger }}', target: '^addContact.body' }] } }
        };
        const memory = memoryHost({ ...BASE, data: { contacts: { c1: { name: 'Ana', vip: true } } } });
        const engine = createLogicEngine(logic, memory.host);

        userChange(memory, engine, '$.data.editing', 'c1');

        expect(memory.get('$.app.children.addContact.body.children.name.value')).toBe('Ana');
        expect(memory.get('$.app.children.addContact.body.children.vip.checked')).toBe(true);
    });

    it('should fill a list window with query', () => {
        // Arrange
        const logic: LogicDocument = {
            rules: {
                window: {
                    when: { path: '$.app.children.contacts.window' },
                    do: [{ command: 'query', from: '$.data.contacts', sort: '-name', filter: "$record.name != 'Cy'", window: '$trigger', into: '^contacts' }]
                }
            }
        };
        const data = { contacts: { a: { name: 'Ana' }, b: { name: 'Bo' }, c: { name: 'Cy' }, d: { name: 'Di' } } };
        const memory = memoryHost({ ...BASE, data });
        const engine = createLogicEngine(logic, memory.host);

        // Act
        userChange(memory, engine, '$.app.children.contacts.window', { first: 1, count: 2 });

        // Assert
        expect(memory.get('$.app.children.contacts.records')).toEqual({ 1: { name: 'Bo', id: 'b' }, 2: { name: 'Ana', id: 'a' } });
        expect(memory.get('$.app.children.contacts.total')).toBe(3);
    });

    it('should write the records into the property the host names, such as the items of a list', () => {
        const logic: LogicDocument = {
            rules: { window: { when: { path: '$.app.children.contacts.window' }, do: [{ command: 'query', from: '$.data.contacts', window: '$trigger', into: '^contacts' }] } }
        };
        const memory = memoryHost({ ...BASE, data: { contacts: { a: { name: 'Ana' } } } }, { records: () => 'items' });
        const engine = createLogicEngine(logic, memory.host);

        userChange(memory, engine, '$.app.children.contacts.window', { first: 0, count: 5 });

        expect(memory.get('$.app.children.contacts.items')).toEqual({ 0: { name: 'Ana', id: 'a' } });
        expect(memory.get('$.app.children.contacts.records')).toBeUndefined();
    });

    it('should report a commit the host refuses', () => {
        const memory = memoryHost(BASE);
        const engine = createLogicEngine(
            { rules: { r: { when: { path: '$.data.go' }, do: [{ command: 'set', target: '$.data.x', value: 1 }] } } },
            { ...memory.host, commit: () => { throw new Error('offline'); } }
        );

        userChange(memory, engine, '$.data.go', true);

        expect(memory.failures).toEqual([{ kind: 'rule', name: 'r', reason: 'offline' }]);
    });
});

describe('readLogic', () => {
    it('should keep valid machines and rules and report nothing', () => {
        const result = readLogic(ADD_CONTACT, { resolve: createLogicIndex(resolveNode(APP, LIBRARY, {}), LIBRARY).resolve });

        expect(result.errors).toEqual([]);
        expect(Object.keys(result.logic.machines ?? {})).toEqual(['addContact']);
        expect(Object.keys(result.logic.rules ?? {})).toEqual(['contactCount']);
    });

    it('should report each kind of error with its state path', () => {
        // Arrange
        const logic = {
            machines: {
                m: {
                    state: '$.app.children.m.phase',
                    initial: 'idle',
                    transitions: [
                        { from: 'busy', when: { path: '$.data.x' }, do: [{ command: 'launch' }] },
                        { when: { path: '$.runtime.x', if: '1 +' } },
                        { when: { result: 'nope' } }
                    ]
                }
            },
            rules: {
                r: { when: { path: '$.data.{id}' }, do: [{ command: 'set', target: '$.data.{other}', extra: 1 }] },
                g: { when: { path: '$.data.x' }, do: [{ command: 'set', target: '^ghost.x', value: 1 }, { command: 'reject' }] }
            },
            other: {}
        };

        // Act
        const result = readLogic(logic, { resolve: () => undefined });

        // Assert
        const found = result.errors.map((error) => [error.code, error.statePath]);
        expect(found).toEqual(
            expect.arrayContaining([
                ['SUI-LOGIC-SHAPE', '$.logic.other'],
                ['SUI-LOGIC-STATE', '$.logic.machines.m.transitions.0.from'],
                ['SUI-LOGIC-COMMAND', '$.logic.machines.m.transitions.0.do.0'],
                ['SUI-LOGIC-PATH', '$.logic.machines.m.transitions.1.when.path'],
                ['SUI-LOGIC-EXPRESSION', '$.logic.machines.m.transitions.1.when.if'],
                ['SUI-LOGIC-SHAPE', '$.logic.machines.m.transitions.2.when.result'],
                ['SUI-LOGIC-PATH', '$.logic.rules.r.do.0.target'],
                ['SUI-LOGIC-SHAPE', '$.logic.rules.r.do.0.extra'],
                ['SUI-LOGIC-PATH', '$.logic.rules.g.do.0.target'],
                ['SUI-LOGIC-SHAPE', '$.logic.rules.g.do.1']
            ])
        );
        expect(result.logic).toEqual({});
    });

    it('should list the allowed keys in the message of an unknown key', () => {
        // Arrange
        const logic = Object.freeze({ rules: { r: { when: { path: '$.data.x' }, do: [{ command: 'reject' }], zz: 1 } } });

        // Act
        const result = readLogic(logic, { resolve: () => undefined });

        // Assert
        const error = result.errors.find((found) => found.statePath === '$.logic.rules.r.zz');
        expect(error?.code).toBe('SUI-LOGIC-SHAPE');
        expect(error?.message).toBe('Logic at $.logic.rules.r.zz is not valid: unknown key "zz" (the keys here are "when", "do")');
    });
});

describe('validateDocument with logic', () => {
    it('should accept a document with logic and report its errors', () => {
        // Arrange
        const valid = { app: APP, data: { contacts: {} }, logic: ADD_CONTACT };
        const invalid = { app: APP, logic: { rules: { r: { when: { path: '$.data.x' }, do: [{ command: 'set', target: '^ghost' }] } } } };

        // Act
        const ok = validateDocument(valid, LIBRARY);
        const bad = validateDocument(invalid, LIBRARY);

        // Assert
        expect(ok.errors.filter((error) => error.code.startsWith('SUI-LOGIC') || error.code === 'SUI-DOC-KEY')).toEqual([]);
        expect(bad.errors.map((error) => error.code)).toContain('SUI-LOGIC-PATH');
    });

    it('should refuse $.server in logic outside Full mode', () => {
        const document = { app: APP, logic: { rules: { r: { when: { path: '$.server.x' }, do: [{ command: 'set', target: '$.data.x', value: 1 }] } } } };

        expect(validateDocument(document, LIBRARY, { mode: 'standalone' }).errors.map((error) => error.code)).toContain('SUI-DOC-SERVER');
        expect(validateDocument(document, LIBRARY, { mode: 'full' }).errors.filter((error) => error.code.startsWith('SUI-LOGIC'))).toEqual([]);
    });
});

/** A clock whose timers run only when the test moves it on */
function fakeClock() {
    let now = 0;
    let timers: { at: number; run: () => void; id: number }[] = [];
    let next = 0;
    const schedule = (ms: number, run: () => void): (() => void) => {
        const id = (next += 1);
        timers.push({ at: now + ms, run, id });
        return () => {
            timers = timers.filter((timer) => timer.id !== id);
        };
    };
    const advance = (ms: number): void => {
        const until = now + ms;
        for (;;) {
            const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
            if (!due) break;
            timers = timers.filter((timer) => timer.id !== due.id);
            now = due.at;
            due.run();
        }
        now = until;
    };
    return { schedule, advance, pending: () => timers.length };
}

describe('createLogicEngine: deriving rules at start', () => {
    const DATA: JsonObject = Object.freeze({ app: BASE['app'] as JsonValue, data: { bag: { a: { qty: 2 }, b: { qty: 3 } }, count: 0, flag: false } }) as JsonObject;

    it('should run each rule that only derives values once at start, in chain order, from the data already there', () => {
        // Arrange
        const logic = {
            rules: {
                label: { when: { path: '$.data.count' }, do: [{ command: 'set', target: '$.data.label', value: 'Items: {{ $.data.count }}' }] },
                count: { when: { path: '$.data.bag.*.qty' }, do: [{ command: 'set', target: '$.data.count', value: '{{ size($.data.bag) }}' }] }
            }
        } as unknown as LogicDocument;
        const memory = memoryHost(DATA);
        const engine = createLogicEngine(logic, memory.host);

        // Act
        engine.start();

        // Assert
        expect(memory.get('$.data.count')).toBe(2);
        expect(memory.get('$.data.label')).toBe('Items: 2');
        expect(engine.trace().map((run) => run.cause)).toEqual(['start']);
        expect(memory.failures).toEqual([]);
    });

    it('should derive every record a rule with a capture matches, not only the first', () => {
        // Arrange
        const logic = {
            rules: { line: { when: { path: '$.data.bag.{id}.qty' }, do: [{ command: 'set', target: '$.data.bag.{id}.double', value: '{{ $trigger * 2 }}' }] } }
        } as unknown as LogicDocument;
        const memory = memoryHost(DATA);
        const engine = createLogicEngine(logic, memory.host);

        // Act
        engine.start();

        // Assert
        expect(memory.get('$.data.bag.a.double')).toBe(4);
        expect(memory.get('$.data.bag.b.double')).toBe(6);
        expect(memory.failures).toEqual([]);
    });

    it('should leave the deriving pass to derive() when start is told not to run it', () => {
        // Arrange
        const logic = { rules: { count: { when: { path: '$.data.bag' }, do: [{ command: 'set', target: '$.data.count', value: '{{ size($.data.bag) }}' }] } } } as unknown as LogicDocument;
        const memory = memoryHost(DATA);
        const engine = createLogicEngine(logic, memory.host);

        // Act
        engine.start({ derive: false });
        const before = memory.get('$.data.count');
        engine.derive();

        // Assert
        expect(before).toBe(0);
        expect(memory.get('$.data.count')).toBe(2);
    });

    it('should leave rules that act, need a change or have no trigger value until a change', () => {
        // Arrange
        const logic = {
            rules: {
                announce: { when: { path: '$.data.bag' }, do: [{ command: 'notify', target: 'toast', value: { text: 'Bag changed' } }] },
                flip: { when: { path: '$.data.bag' }, do: [{ command: 'toggle', target: '$.data.flag' }] },
                moved: { when: { path: '$.data.count', was: 0 }, do: [{ command: 'set', target: '$.data.moved', value: true }] },
                missing: { when: { path: '$.data.nothing' }, do: [{ command: 'set', target: '$.data.seen', value: true }] }
            }
        } as unknown as LogicDocument;
        const memory = memoryHost(DATA);
        const engine = createLogicEngine(logic, memory.host);

        // Act
        engine.start();

        // Assert
        expect(memory.notices).toEqual([]);
        expect(memory.get('$.data.flag')).toBe(false);
        expect(memory.get('$.data.moved')).toBeUndefined();
        expect(memory.get('$.data.seen')).toBeUndefined();
        expect(memory.commits).toEqual([]);
    });
});

describe('createLogicEngine: $previous and was', () => {
    const STATUS: LogicDocument = Object.freeze({
        rules: {
            sent: {
                when: { path: '$.data.invoices.{invoice}.status', was: 'draft', is: 'sent' },
                do: [{ command: 'set', target: '$.data.log.{invoice}', value: '{{ $previous }} to {{ $trigger }}' }]
            }
        }
    }) as LogicDocument;

    it('should fire only when the value before the change matches was', () => {
        // Arrange
        const memory = memoryHost({ data: { invoices: { i1: { status: 'draft' }, i2: { status: 'paid' } }, log: {} } });
        const engine = createLogicEngine(STATUS, memory.host);

        // Act
        memory.apply({ path: '$.data.invoices.i1.status', value: 'sent' });
        engine.changes([{ path: '$.data.invoices.i1.status', value: 'sent', previous: 'draft' }]);
        memory.apply({ path: '$.data.invoices.i2.status', value: 'sent' });
        engine.changes([{ path: '$.data.invoices.i2.status', value: 'sent', previous: 'paid' }]);

        // Assert
        expect(memory.get('$.data.log')).toEqual({ i1: 'draft to sent' });
    });

    it('should derive $previous when the change is above or below the trigger path', () => {
        // Arrange
        const memory = memoryHost({ data: { invoices: { i1: { status: 'sent', total: 5 } }, log: {} } });
        const below = createLogicEngine(
            { rules: { r: { when: { path: '$.data.invoices.i1' }, do: [{ command: 'set', target: '$.data.log.before', value: '$previous' }] } } } as LogicDocument,
            memory.host
        );
        const above = createLogicEngine(STATUS, memory.host);

        // Act
        below.changes([{ path: '$.data.invoices.i1.status', value: 'sent', previous: 'draft' }]);
        above.changes([{ path: '$.data.invoices', value: { i1: { status: 'sent', total: 5 } }, previous: { i1: { status: 'draft', total: 5 } } }]);

        // Assert
        expect(memory.get('$.data.log.before')).toEqual({ status: 'draft', total: 5 });
        expect(memory.get('$.data.log.i1')).toBe('draft to sent');
    });

    it('should give a guard the current value as $previous', () => {
        const memory = memoryHost({ data: { level: 3 } });
        const engine = createLogicEngine(
            { rules: { g: { when: { path: '$.data.level', if: '$trigger < $previous' }, do: [{ command: 'reject', reason: 'no going down' }] } } } as LogicDocument,
            memory.host
        );

        expect(engine.guard({ path: '$.data.level', value: 2 })).toBe('no going down');
        expect(engine.guard({ path: '$.data.level', value: 4 })).toBeUndefined();
    });

    it('should pass the previous value of chained writes on', () => {
        // Arrange
        const memory = memoryHost({ data: { a: 1, b: 0, log: '' } });
        const logic = {
            rules: {
                copy: { when: { path: '$.data.a' }, do: [{ command: 'set', target: '$.data.b', value: '$trigger' }] },
                log: { when: { path: '$.data.b' }, do: [{ command: 'set', target: '$.data.log', value: '{{ $previous }}>{{ $trigger }}' }] }
            }
        } as LogicDocument;
        const engine = createLogicEngine(logic, memory.host);

        // Act
        userChange(memory, engine, '$.data.a', 7);

        // Assert
        expect(memory.get('$.data.log')).toBe('0>7');
    });
});

describe('createLogicEngine: lookup tables', () => {
    const SHIPPING: LogicDocument = Object.freeze({
        tables: {
            shipping: {
                inputs: {
                    country: { path: '$.data.order.country', values: ['NL', 'BE', '*'] },
                    total: { path: '$.data.order.total', breaks: [50, 100] }
                },
                outputs: { fee: '$.data.order.shipping', days: '$.data.order.eta' },
                rows: [
                    { country: 'NL', total: '>=50', fee: 0, days: 1 },
                    { country: ['NL', 'BE'], fee: 5, days: 2 },
                    { fee: '{{ $total / 10 }}', days: 4 }
                ]
            }
        }
    }) as LogicDocument;

    it('should write the outputs of the first row that matches, and the default otherwise', () => {
        // Arrange
        const memory = memoryHost({ data: { order: {} } });
        const engine = createLogicEngine(SHIPPING, memory.host);

        // Act / Assert
        userChange(memory, engine, '$.data.order', { country: 'NL', total: 60 });
        expect([memory.get('$.data.order.shipping'), memory.get('$.data.order.eta')]).toEqual([0, 1]);
        userChange(memory, engine, '$.data.order.total', 20);
        expect([memory.get('$.data.order.shipping'), memory.get('$.data.order.eta')]).toEqual([5, 2]);
        userChange(memory, engine, '$.data.order', { country: 'DE', total: 80 });
        expect([memory.get('$.data.order.shipping'), memory.get('$.data.order.eta')]).toEqual([8, 4]);
        expect(engine.names).toEqual(['shipping']);
        expect(memory.failures).toEqual([]);
    });

    it('should write only the outputs that change, and nothing when none does', () => {
        // Arrange
        const memory = memoryHost({ data: { order: { country: 'NL', total: 20 } } });
        const engine = createLogicEngine(SHIPPING, memory.host);
        engine.start();
        const before = memory.commits.length;

        // Act: BE gives the same row as NL below 50
        userChange(memory, engine, '$.data.order.country', 'BE');

        // Assert
        expect(memory.commits.length).toBe(before);
        expect(engine.trace().at(-1)?.events).toEqual([expect.objectContaining({ kind: 'table', name: 'shipping', outcome: 'unchanged', row: 1, writes: [] })]);
    });

    it('should run in the derive pass at start', () => {
        // Arrange
        const memory = memoryHost({ data: { order: { country: 'BE', total: 120 } } });
        const engine = createLogicEngine(SHIPPING, memory.host);

        // Act
        engine.start();

        // Assert
        expect(memory.get('$.data.order.shipping')).toBe(5);
        expect(engine.trace()[0]?.events[0]).toEqual(expect.objectContaining({ outcome: 'fired', row: 1, writes: ['$.data.order.shipping', '$.data.order.eta'] }));
    });

    it('should skip a table while an input has no value, and fail on a value its input does not list', () => {
        // Arrange
        const logic: LogicDocument = {
            tables: {
                size: {
                    inputs: { kind: { path: '$.data.kind', values: ['a', 'b'] } },
                    outputs: { label: '$.data.label' },
                    rows: [{ kind: 'a', label: 'A' }, { kind: 'b', label: 'B' }]
                }
            }
        };
        const memory = memoryHost({ data: {} });
        const engine = createLogicEngine(logic, memory.host);
        engine.start();

        // Act
        userChange(memory, engine, '$.data.kind', 'c');

        // Assert
        expect(memory.get('$.data.label')).toBeUndefined();
        expect(memory.failures).toEqual([{ kind: 'table', name: 'size', reason: 'input "kind" is "c", which is not one of its values' }]);
    });

    it('should run per record for the records whose inputs changed', () => {
        // Arrange
        const logic: LogicDocument = {
            tables: {
                band: {
                    inputs: { qty: { path: '$.data.lines.{id}.qty', breaks: [10] }, price: '$.data.lines.{id}.price' },
                    outputs: { total: '$.data.lines.{id}.total', bulk: '$.data.lines.{id}.bulk' },
                    rows: [
                        { qty: '<10', total: '{{ $qty * $price }}', bulk: false },
                        { total: '{{ $qty * $price * 0.9 }}', bulk: true }
                    ]
                }
            }
        };
        const memory = memoryHost({ data: { lines: { a: { qty: 1, price: 10 }, b: { qty: 20, price: 1 } } } });
        const engine = createLogicEngine(logic, memory.host);
        engine.start();
        const before = memory.commits.length;

        // Act
        userChange(memory, engine, '$.data.lines.a.qty', 12);

        // Assert
        expect(memory.get('$.data.lines.a')).toEqual({ qty: 12, price: 10, total: 108, bulk: true });
        expect(memory.get('$.data.lines.b')).toEqual({ qty: 20, price: 1, total: 18, bulk: true });
        expect(memory.commits.slice(before)).toEqual([[
            { path: '$.data.lines.a.total', value: 108 },
            { path: '$.data.lines.a.bulk', value: true }
        ]]);
    });

    it('should run before a rule that reads its outputs, and run once per chain', () => {
        // Arrange
        const logic: LogicDocument = {
            rules: { notice: { when: { path: '$.data.order.shipping', is: 0 }, do: [{ command: 'set', target: '$.data.free', value: true }] } },
            tables: SHIPPING.tables as NonNullable<LogicDocument['tables']>
        };
        const memory = memoryHost({ data: { order: {} } });
        const engine = createLogicEngine(logic, memory.host);

        // Act
        userChange(memory, engine, '$.data.order', { country: 'NL', total: 70 });

        // Assert
        expect(memory.get('$.data.free')).toBe(true);
        expect(memory.commits).toHaveLength(2);
        expect(memory.failures).toEqual([]);
    });

    it('should take an input from a value expression', () => {
        // Arrange
        const logic: LogicDocument = {
            tables: {
                cart: {
                    inputs: { empty: { value: '{{ size($.data.cart) == 0 }}', values: [true, false] } },
                    outputs: { message: '$.data.message' },
                    rows: [{ empty: true, message: 'Your cart is empty' }, { message: '' }]
                }
            }
        };
        const memory = memoryHost({ data: { cart: {} } });
        const engine = createLogicEngine(logic, memory.host);
        engine.start();
        expect(memory.get('$.data.message')).toBe('Your cart is empty');

        // Act
        userChange(memory, engine, '$.data.cart.p1', 1);

        // Assert
        expect(memory.get('$.data.message')).toBe('');
    });

    it('should give the outputs of the winning row to lookup in expressions', () => {
        // Arrange
        const logic: LogicDocument = {
            tables: SHIPPING.tables as NonNullable<LogicDocument['tables']>,
            rules: { quote: { when: { path: '$.data.ask' }, do: [{ command: 'set', target: '$.data.quote', value: "{{ lookup('shipping', $trigger, 30) }}" }] } }
        };
        const memory = memoryHost({ data: { order: {} } });
        const engine = createLogicEngine(logic, memory.host);

        // Act
        userChange(memory, engine, '$.data.ask', 'DE');

        // Assert
        expect(memory.get('$.data.quote')).toEqual({ fee: 3, days: 4 });
        expect(memory.get('$.data.order.shipping')).toBeUndefined();
    });

    it('should take rows and input values from data, compile again when they change and keep the last good rows', () => {
        // Arrange
        const logic: LogicDocument = {
            tables: {
                rate: {
                    inputs: { country: { path: '$.data.order.country', values: { keys: '$.data.countries' } } },
                    outputs: { fee: '$.data.order.fee' },
                    rows: { from: '$.data.rates' }
                }
            }
        };
        const memory = memoryHost({
            data: {
                countries: { NL: true, BE: true },
                rates: { r2: { order: 2, fee: 9 }, r1: { order: 1, country: 'NL', fee: 1 } },
                order: { country: 'NL' }
            }
        });
        const engine = createLogicEngine(logic, memory.host);
        engine.start();
        expect(memory.get('$.data.order.fee')).toBe(1);

        // Act: a rate edited in data
        userChange(memory, engine, '$.data.rates.r1.fee', 2);
        // Assert
        expect(memory.get('$.data.order.fee')).toBe(2);

        // Act: a version with a gap fails and keeps the last good rows
        userChange(memory, engine, '$.data.rates.r2.country', 'NL');
        // Assert
        expect(memory.failures).toEqual([{ kind: 'table', name: 'rate', reason: 'no row for country "BE"; the last good rows stay in use' }]);
        userChange(memory, engine, '$.data.order.country', 'BE');
        expect(memory.get('$.data.order.fee')).toBe(9);
    });

    it('should report the problems of a table', () => {
        // Arrange
        const logic = {
            tables: {
                t: {
                    inputs: { trigger: '$.data.y', a: { path: '$.data.a', values: ['x', 'y'] }, p: '$.data.p' },
                    outputs: { out: '$.data.out' },
                    rows: [{ a: 'x', out: 1 }, { a: 'z', out: 2 }, { p: 1, out: 3 }, { b: 1 }]
                },
                gap: {
                    inputs: { a: { path: '$.data.a', values: ['x', 'y'] } },
                    outputs: { out: '$.data.out' },
                    rows: [{ a: 'x', out: 1 }]
                }
            }
        };

        // Act
        const result = readLogic(logic);

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual(
            expect.arrayContaining([
                ['SUI-LOGIC-SHAPE', '$.logic.tables.t.inputs.trigger'],
                ['SUI-LOGIC-GAP', '$.logic.tables.gap.rows']
            ])
        );
        expect(result.errors.find((error) => error.code === 'SUI-LOGIC-GAP')?.message).toContain('a "y"');
        expect(result.logic).toEqual({});
    });

    it('should warn about a row that never wins and a table too large to compile', () => {
        // Arrange
        const breaks = Array.from({ length: 70 }, (_, index) => index);
        const logic = {
            tables: {
                late: {
                    inputs: { a: { path: '$.data.a', values: ['x', '*'] } },
                    outputs: { out: '$.data.out' },
                    rows: [{ out: 1 }, { a: 'x', out: 2 }]
                },
                big: {
                    inputs: { a: { path: '$.data.a', breaks }, b: { path: '$.data.b', breaks } },
                    outputs: { out: '$.data.big' },
                    rows: [{ out: 1 }]
                }
            }
        };

        // Act
        const result = readLogic(logic);

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-LOGIC-UNREACHABLE', '$.logic.tables.late.rows.1'],
            ['SUI-LOGIC-SIZE', '$.logic.tables.big.inputs']
        ]);
        expect(Object.keys(result.logic.tables ?? {})).toEqual(['late', 'big']);
    });

    it('should report tables that feed each other in a cycle', () => {
        // Arrange
        const logic = {
            tables: {
                a: { inputs: { x: '$.data.x' }, outputs: { y: '$.data.y' }, rows: [{ y: '{{ $x }}' }] },
                b: { inputs: { y: '$.data.y' }, outputs: { x: '$.data.x' }, rows: [{ x: '{{ $y }}' }] },
                c: { inputs: { y: '$.data.y' }, outputs: { z: '$.data.z' }, rows: [{ z: 1 }] }
            }
        };

        // Act
        const result = readLogic(logic);

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-LOGIC-CYCLE', '$.logic.tables.a'],
            ['SUI-LOGIC-CYCLE', '$.logic.tables.b']
        ]);
        expect(result.errors[0]?.message).toContain('tables.a → tables.b → tables.a');
        expect(Object.keys(result.logic.tables ?? {})).toEqual(['c']);
    });
});

describe('createLogicEngine: compute functions', () => {
    const TAX: LogicDocument = Object.freeze({
        computes: {
            tax: {
                inputs: { amount: '$.data.lines.{id}.amount', rate: { value: '{{ $.data.rate }}' } },
                run: 'tax',
                outputs: { tax: '$.data.lines.{id}.tax', gross: '$.data.lines.{id}.gross' }
            }
        }
    }) as LogicDocument;
    const tax: LogicComputeFunction = ({ amount, rate }) => {
        const net = typeof amount === 'number' ? amount : 0;
        const share = Math.round(net * (typeof rate === 'number' ? rate : 0) * 100) / 100;
        return { tax: share, gross: net + share };
    };

    it('should run the function per record and write only the outputs that change', () => {
        // Arrange
        const memory = memoryHost({ data: { rate: 0.2, lines: { a: { amount: 10 }, b: { amount: 5 } } } }, { functions: { compute: { tax } } });
        const engine = createLogicEngine(TAX, memory.host);
        engine.start();
        const before = memory.commits.length;

        // Act
        userChange(memory, engine, '$.data.lines.a.amount', 20);

        // Assert
        expect(memory.get('$.data.lines')).toEqual({ a: { amount: 20, tax: 4, gross: 24 }, b: { amount: 5, tax: 1, gross: 6 } });
        expect(memory.commits.slice(before)).toEqual([[
            { path: '$.data.lines.a.tax', value: 4 },
            { path: '$.data.lines.a.gross', value: 24 }
        ]]);
        expect(engine.names).toEqual(['tax']);
        expect(engine.trace().at(-1)?.events).toEqual([expect.objectContaining({ kind: 'compute', name: 'tax', outcome: 'fired', path: 'id=a' })]);
        expect(memory.failures).toEqual([]);
    });

    it('should run every record when an input that does not capture changes', () => {
        // Arrange
        const memory = memoryHost({ data: { rate: 0.2, lines: { a: { amount: 10 }, b: { amount: 5 } } } }, { functions: { compute: { tax } } });
        const engine = createLogicEngine(TAX, memory.host);
        engine.start();

        // Act
        userChange(memory, engine, '$.data.rate', 0.1);

        // Assert
        expect(memory.get('$.data.lines')).toEqual({ a: { amount: 10, tax: 1, gross: 11 }, b: { amount: 5, tax: 0.5, gross: 5.5 } });
    });

    it('should fail and write nothing when the function is not registered, throws or returns no object', () => {
        // Arrange
        const thrower: LogicComputeFunction = () => {
            throw new Error('boom');
        };
        const cases: [LogicHost['functions'], string][] = [
            [undefined, 'the host registered no compute function "tax"'],
            [{ compute: { tax: thrower } }, 'boom'],
            [{ compute: { tax: () => 3 as never } }, 'compute function "tax" returned number, not an object of outputs']
        ];
        for (const [functions, reason] of cases) {
            const memory = memoryHost({ data: { rate: 0.2, lines: { a: { amount: 10 } } } }, functions ? { functions } : {});
            const engine = createLogicEngine(TAX, memory.host);

            // Act
            engine.start();

            // Assert
            expect(memory.get('$.data.lines.a')).toEqual({ amount: 10 });
            expect(memory.failures).toEqual([expect.objectContaining({ kind: 'compute', name: 'tax', reason: expect.stringContaining(reason) })]);
        }
    });

    it('should give the function a copy of the inputs and ignore outputs it does not declare', () => {
        // Arrange
        const seen: unknown[] = [];
        const memory = memoryHost({ data: { rate: 0.5, lines: { a: { amount: 2 } } } }, {
            functions: {
                compute: {
                    tax: (inputs) => {
                        seen.push(inputs);
                        (inputs as Record<string, unknown>)['amount'] = 99;
                        return { tax: 1, other: 7 };
                    }
                }
            }
        });
        const engine = createLogicEngine(TAX, memory.host);

        // Act
        engine.start();

        // Assert
        expect(seen).toEqual([{ amount: 99, rate: 0.5 }]);
        expect(memory.get('$.data.lines.a')).toEqual({ amount: 2, tax: 1 });
    });

    it('should let expressions call the host functions, but not one named like a built-in', () => {
        // Arrange
        const logic: LogicDocument = { rules: { label: { when: { path: '$.data.name' }, do: [{ command: 'set', target: '$.data.label', value: '{{ shout($.data.name) }}' }] } } };
        const memory = memoryHost({ data: {} }, {
            functions: { expressions: { shout: (text) => `${String(text).toUpperCase()}!`, round: () => 0 } }
        });
        const engine = createLogicEngine(logic, memory.host);

        // Act
        userChange(memory, engine, '$.data.name', 'ann');

        // Assert
        expect(memory.get('$.data.label')).toBe('ANN!');
        expect(memory.failures).toEqual([{ kind: 'compute', name: 'round', reason: `"round" is a built-in function, so the host's function of that name is not used` }]);
    });

    it('should run a compute unit after the table that feeds it', () => {
        // Arrange
        const logic: LogicDocument = {
            computes: { gross: { inputs: { net: '$.data.net' }, run: 'double', outputs: { out: '$.data.gross' } } },
            tables: { net: { inputs: { kind: { path: '$.data.kind', values: ['a', '*'] } }, outputs: { net: '$.data.net' }, rows: [{ kind: 'a', net: 10 }, { net: 1 }] } }
        };
        const memory = memoryHost({ data: {} }, { functions: { compute: { double: ({ net }) => ({ out: typeof net === 'number' ? net * 2 : null }) } } });
        const engine = createLogicEngine(logic, memory.host);
        engine.start();

        // Act
        userChange(memory, engine, '$.data.kind', 'a');

        // Assert
        expect(memory.get('$.data.gross')).toBe(20);
        expect(engine.names).toEqual(['net', 'gross']);
    });
});

describe('readLogic: compute units', () => {
    it('should read a compute unit and warn about a function the host has not registered', () => {
        // Arrange
        const logic = { computes: { tax: { inputs: { a: '$.data.a' }, run: 'tax', outputs: { b: '$.data.b' } } } } as unknown as JsonValue;

        // Act
        const known = readLogic(logic, { functions: { compute: { tax: () => ({}) } } });
        const unknown = readLogic(logic, { functions: {} });

        // Assert
        expect(known.errors).toEqual([]);
        expect(Object.keys(known.logic.computes ?? {})).toEqual(['tax']);
        expect(unknown.errors.map((error) => [error.code, error.severity, error.statePath])).toEqual([['SUI-LOGIC-FUNCTION', 'warning', '$.logic.computes.tax.run']]);
        expect(Object.keys(unknown.logic.computes ?? {})).toEqual(['tax']);
    });

    it('should refuse table domains, a missing run and an unknown key', () => {
        // Arrange
        const logic = {
            computes: { tax: { inputs: { a: { path: '$.data.a', values: [1, 2] } }, run: '', outputs: { b: '$.data.b' }, rows: [] } }
        } as unknown as JsonValue;

        // Act
        const result = readLogic(logic);

        // Assert
        expect(result.errors.map((error) => error.statePath)).toEqual(expect.arrayContaining(['$.logic.computes.tax.inputs.a', '$.logic.computes.tax.run', '$.logic.computes.tax.rows']));
        expect(result.logic.computes).toBeUndefined();
    });

    it('should report a compute unit and a table that feed each other', () => {
        // Arrange
        const logic = {
            computes: { c: { inputs: { x: '$.data.x' }, run: 'f', outputs: { y: '$.data.y' } } },
            tables: { t: { inputs: { y: '$.data.y' }, outputs: { x: '$.data.x' }, rows: [{ x: '{{ $y }}' }] } }
        } as unknown as JsonValue;

        // Act
        const result = readLogic(logic);

        // Assert
        expect(result.errors.map((error) => error.code)).toEqual(['SUI-LOGIC-CYCLE', 'SUI-LOGIC-CYCLE']);
        expect(result.logic.computes).toEqual({});
        expect(result.logic.tables).toEqual({});
    });
});

describe('createLogicEngine: timers', () => {
    const TOAST: LogicDocument = Object.freeze({
        machines: {
            toast: {
                state: '$.app.toast.phase',
                initial: 'hidden',
                transitions: [
                    { from: 'hidden', when: { path: '$.app.toast.text' }, to: 'shown' },
                    { from: 'shown', when: { after: 3000 }, do: [{ command: 'set', target: '$.app.toast.text', value: '' }], to: 'hidden' }
                ]
            }
        }
    }) as LogicDocument;

    it('should fire an after transition once its machine has stayed in from that long', () => {
        // Arrange
        const clock = fakeClock();
        const memory = memoryHost({ app: { toast: { text: '' } } }, { schedule: clock.schedule });
        const engine = createLogicEngine(TOAST, memory.host);
        engine.start();

        // Act
        userChange(memory, engine, '$.app.toast.text', 'Saved');
        clock.advance(2999);
        const before = memory.get('$.app.toast.phase');
        clock.advance(1);

        // Assert
        expect(before).toBe('shown');
        expect(memory.get('$.app.toast.phase')).toBe('hidden');
        expect(memory.get('$.app.toast.text')).toBe('');
        expect(clock.pending()).toBe(0);
    });

    it('should cancel an after timer when its machine leaves the state', () => {
        // Arrange
        const clock = fakeClock();
        const memory = memoryHost({ app: { toast: { text: '' } } }, { schedule: clock.schedule });
        const engine = createLogicEngine(TOAST, memory.host);
        engine.start();
        userChange(memory, engine, '$.app.toast.text', 'Saved');

        // Act: an agent closes the toast by its state
        userChange(memory, engine, '$.app.toast.phase', 'hidden');
        clock.advance(5000);

        // Assert
        expect(memory.get('$.app.toast.text')).toBe('Saved');
        expect(clock.pending()).toBe(0);
    });

    it('should arm an after timer on start for the state a machine is already in', () => {
        const clock = fakeClock();
        const memory = memoryHost({ app: { toast: { text: 'Old', phase: 'shown' } } }, { schedule: clock.schedule });
        const engine = createLogicEngine(TOAST, memory.host);

        engine.start();
        clock.advance(3000);

        expect(memory.get('$.app.toast.phase')).toBe('hidden');
    });

    it('should fire a debounced trigger once after the changes stop, with the last value', () => {
        // Arrange
        const clock = fakeClock();
        const memory = memoryHost({ app: { search: '' }, data: { searches: 0, last: '' } }, { schedule: clock.schedule });
        const logic = {
            rules: {
                search: {
                    when: { path: '$.app.search', debounce: 300 },
                    do: [
                        { command: 'increment', target: '$.data.searches' },
                        { command: 'set', target: '$.data.last', value: '$trigger' }
                    ]
                }
            }
        } as LogicDocument;
        const engine = createLogicEngine(logic, memory.host);

        // Act
        userChange(memory, engine, '$.app.search', 'a');
        clock.advance(200);
        userChange(memory, engine, '$.app.search', 'an');
        clock.advance(200);
        userChange(memory, engine, '$.app.search', 'ana');
        clock.advance(299);
        const early = memory.get('$.data.searches');
        clock.advance(1);

        // Assert
        expect(early).toBe(0);
        expect(memory.get('$.data.searches')).toBe(1);
        expect(memory.get('$.data.last')).toBe('ana');
    });

    it('should cancel its timers when stopped', () => {
        const clock = fakeClock();
        const memory = memoryHost({ app: { toast: { text: '' } } }, { schedule: clock.schedule });
        const engine = createLogicEngine(TOAST, memory.host);
        engine.start();
        userChange(memory, engine, '$.app.toast.text', 'Saved');

        engine.stop();
        clock.advance(5000);

        expect(memory.get('$.app.toast.phase')).toBe('shown');
    });

    it('should refuse timers where they cannot run', () => {
        // Arrange
        const logic = {
            machines: {
                m: {
                    state: '$.app.m',
                    initial: 'a',
                    transitions: [{ when: { after: 10 }, to: 'a' }, { from: 'a', when: { after: 0.5 } }, { from: 'a', when: { path: '$.data.x', after: 10 } }]
                }
            },
            rules: {
                r: { when: { after: 10 }, do: [{ command: 'set', target: '$.data.x', value: 1 }] },
                g: { when: { path: '$.data.x', debounce: 10 }, do: [{ command: 'reject', reason: 'no' }] }
            }
        };

        // Act
        const paths = readLogic(logic).errors.map((error) => error.statePath);

        // Assert
        expect(paths).toEqual(
            expect.arrayContaining([
                '$.logic.machines.m.transitions.0.when.after',
                '$.logic.machines.m.transitions.1.when.after',
                '$.logic.machines.m.transitions.2.when',
                '$.logic.rules.r.when.after',
                '$.logic.rules.g.when.debounce'
            ])
        );
    });
});

describe('createLogicEngine: call', () => {
    const LOOKUP: LogicDocument = Object.freeze({
        machines: {
            lookup: {
                state: '$.app.lookup.phase',
                initial: 'idle',
                transitions: [
                    { from: 'idle', when: { path: '$.app.lookup.query' }, do: [{ command: 'call', target: 'findCompany', value: { name: '$trigger' }, as: 'found' }], to: 'waiting' },
                    { from: 'waiting', when: { result: 'found', is: 'accepted' }, do: [{ command: 'set', target: '$.app.lookup.answer', value: '$result.value' }], to: 'idle' },
                    { from: 'waiting', when: { result: 'found', is: 'rejected' }, do: [{ command: 'set', target: '$.app.lookup.answer', value: '$result.reason' }], to: 'idle' }
                ]
            }
        }
    }) as LogicDocument;

    it('should wait for the answer of a call and give it to the machine', async () => {
        // Arrange
        const calls: [string, JsonValue][] = [];
        const memory = memoryHost(
            { app: { lookup: {} } },
            {
                call: async (name, payload) => {
                    calls.push([name, payload]);
                    return { status: 'accepted', value: { id: 'k1' } };
                }
            }
        );
        const engine = createLogicEngine(LOOKUP, memory.host);
        engine.start();

        // Act
        userChange(memory, engine, '$.app.lookup.query', 'Acme');
        const waiting = memory.get('$.app.lookup.phase');
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Assert
        expect(waiting).toBe('waiting');
        expect(calls).toEqual([['findCompany', { name: 'Acme' }]]);
        expect(memory.get('$.app.lookup.answer')).toEqual({ id: 'k1' });
        expect(memory.get('$.app.lookup.phase')).toBe('idle');
    });

    it('should reject a call when nothing answers calls, and when the answer fails', async () => {
        // Arrange
        const plain = memoryHost({ app: { lookup: {} } });
        const failing = memoryHost({ app: { lookup: {} } }, { call: () => Promise.reject(new Error('offline')) });
        const first = createLogicEngine(LOOKUP, plain.host);
        const second = createLogicEngine(LOOKUP, failing.host);
        first.start();
        second.start();

        // Act
        userChange(plain, first, '$.app.lookup.query', 'Acme');
        userChange(failing, second, '$.app.lookup.query', 'Acme');
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Assert
        expect(plain.get('$.app.lookup.answer')).toBe('no server answers "findCompany"');
        expect(failing.get('$.app.lookup.answer')).toBe('offline');
    });

    it('should refuse call outside a machine, without as, and outside Full mode', () => {
        // Arrange
        const logic = {
            rules: { r: { when: { path: '$.data.x' }, do: [{ command: 'call', target: 'p', as: 'x' }] } },
            machines: { m: { state: '$.app.m', initial: 'a', transitions: [{ when: { path: '$.data.y' }, do: [{ command: 'call', target: 'p' }] }] } }
        };
        const document = { app: APP, logic: LOOKUP as unknown as JsonValue };

        // Act
        const paths = readLogic(logic).errors.map((error) => error.statePath);

        // Assert
        expect(paths).toEqual(expect.arrayContaining(['$.logic.rules.r.do.0', '$.logic.machines.m.transitions.0.do.0']));
        expect(validateDocument(document, LIBRARY, { mode: 'persisted' }).errors.map((error) => error.code)).toContain('SUI-DOC-SERVER');
        expect(validateDocument(document, LIBRARY, { mode: 'full' }).errors.filter((error) => error.code === 'SUI-DOC-SERVER')).toEqual([]);
    });
});

describe('createLogicEngine: changes, removals and the trace', () => {
    const DATA: JsonObject = Object.freeze({
        app: BASE['app'] as JsonValue,
        data: { flag: false, count: 0, products: { p1: { stock: 3, label: 'In stock' }, p2: { stock: 0, label: 'Sold out' } }, orders: { o1: { status: 'Delivered' } } }
    }) as JsonObject;

    it('should not fire a trigger when the value did not change', () => {
        // Arrange
        const memory = memoryHost(DATA);
        const engine = createLogicEngine({ rules: { r: { when: { path: '$.data.flag' }, do: [{ command: 'increment', target: '$.data.count' }] } } }, memory.host);

        // Act
        userChange(memory, engine, '$.data.flag', false);
        engine.changes([{ path: '$.data', value: memory.get('$.data') as JsonValue, previous: memory.get('$.data') as JsonValue }]);
        userChange(memory, engine, '$.data.flag', true);

        // Assert
        expect(memory.get('$.data.count')).toBe(1);
    });

    it('should not fire a leaf trigger or a guard when its record is removed', () => {
        // Arrange
        const memory = memoryHost(DATA);
        const engine = createLogicEngine(
            {
                rules: {
                    label: { when: { path: '$.data.products.{id}.stock' }, do: [{ command: 'set', target: '$.data.products.{id}.label', value: 'changed' }] },
                    removed: { when: { path: '$.data.products.{id}', is: null }, do: [{ command: 'increment', target: '$.data.count' }] },
                    final: { when: { path: '$.data.orders.{id}.status', was: 'Delivered' }, do: [{ command: 'reject', reason: 'final' }] }
                }
            },
            memory.host
        );

        // Act
        memory.apply({ path: '$.data.products.p1' });
        engine.changes([{ path: '$.data.products.p1', previous: { stock: 3, label: 'In stock' } }]);
        const deleteOrder = engine.guard({ path: '$.data.orders.o1' });
        const changeStatus = engine.guard({ path: '$.data.orders.o1.status', value: 'Cancelled' });
        const sameStatus = engine.guard({ path: '$.data.orders.o1', value: { status: 'Delivered' } });

        // Assert
        expect(memory.get('$.data.products.p1')).toBeUndefined();
        expect(memory.get('$.data.count')).toBe(1);
        expect(deleteOrder).toBeUndefined();
        expect(changeStatus).toBe('final');
        expect(sameStatus).toBeUndefined();
    });

    it('should refuse a set through a missing parent below $.data', () => {
        // Arrange
        const memory = memoryHost(DATA);
        const engine = createLogicEngine(
            { rules: { r: { when: { path: '$.data.flag' }, do: [{ command: 'set', target: '$.data.products.gone.label', value: 'x' }] } } },
            memory.host
        );

        // Act
        userChange(memory, engine, '$.data.flag', true);

        // Assert
        expect(memory.get('$.data.products.gone')).toBeUndefined();
        expect(memory.failures[0]?.reason).toContain('$.data.products.gone does not exist');
    });

    it('should fill trigger captures into expression paths', () => {
        // Arrange
        const memory = memoryHost(DATA);
        const engine = createLogicEngine(
            { rules: { r: { when: { path: '$.data.products.{id}.stock' }, do: [{ command: 'set', target: '$.data.count', value: '{{ $.data.products.{id}.stock * 10 }}' }] } } },
            memory.host
        );

        // Act
        userChange(memory, engine, '$.data.products.p2.stock', 4);

        // Assert
        expect(memory.get('$.data.count')).toBe(40);
        expect(readLogic({ rules: { r: { when: { path: '$.data.x.{id}' }, do: [{ command: 'set', target: '$.data.y', value: '{{ $.data.x.{nope} }}' }] } } }).errors.map((error) => error.message)).toEqual([
            expect.stringContaining('{nope} in a path is not a capture of this trigger')
        ]);
    });

    it('should name the kind of a failing unit and trace why units did or did not fire', () => {
        // Arrange
        const memory = memoryHost(DATA);
        const engine = createLogicEngine(
            {
                rules: {
                    first: { when: { path: '$.data.flag' }, do: [{ command: 'increment', target: '$.data.count' }] },
                    again: { when: { path: '$.data.count' }, do: [{ command: 'set', target: '$.data.flag', value: false }] },
                    never: { when: { path: '$.data.flag', is: 'x' }, do: [{ command: 'increment', target: '$.data.count' }] }
                }
            },
            memory.host
        );

        // Act
        userChange(memory, engine, '$.data.flag', true);
        const [run] = engine.trace();

        // Assert
        expect(run?.cause).toBe('change');
        expect(run?.events.map((event) => [event.depth, event.name, event.outcome])).toEqual([
            [0, 'first', 'fired'],
            [0, 'never', 'condition'],
            [1, 'again', 'fired'],
            [2, 'first', 'already-fired'],
            [2, 'never', 'condition']
        ]);
        expect(run?.events[0]?.writes).toEqual(['$.data.count']);
    });

    it('should name the clashing nodes of an ambiguous reference', () => {
        // Arrange
        const tree = resolveNode(
            { component: 'page', children: { a: { component: 'modal', children: { name: { component: 'textField' } } }, b: { component: 'modal', children: { name: { component: 'textField' } } } } } as unknown as Node,
            LIBRARY,
            {}
        );
        const index = createLogicIndex(tree, LIBRARY);

        // Act
        const errors = readLogic({ rules: { r: { when: { path: '$.data.go' }, do: [{ command: 'set', target: '^name.value', value: 'x' }] } } }, { resolve: index.resolve, explain: index.explain }).errors;

        // Assert
        expect(errors[0]?.message).toContain('2 nodes are named "name": $.app.children.a.children.name, $.app.children.b.children.name');
    });

    it('should warn about a value that is a path written as a text template', () => {
        const { errors } = readLogic({ rules: { r: { when: { path: '$.data.x.{id}' }, do: [{ command: 'set', target: '$.data.y', value: '$.data.x.{{ $id }}.name' }] } } });

        expect(errors.map((error) => [error.code, error.severity])).toEqual([['SUI-LOGIC-TEXT-PATH', 'warning']]);
    });
});
