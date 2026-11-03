import { describe, expect, it } from 'vitest';
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
import type { LogicDocument, LogicFailure, LogicHost, LogicWrite } from './index.js';

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
    memory.apply({ path, value });
    engine.changes([{ path, value }]);
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
        expect(memory.failures).toEqual([{ machine: 'broken', command: 1, reason: '$.data.missing has no value' }]);
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

        engine.changes([{ path: '$.data.go', value: true }]);

        expect(memory.failures).toEqual([{ machine: 'r', reason: 'offline' }]);
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
