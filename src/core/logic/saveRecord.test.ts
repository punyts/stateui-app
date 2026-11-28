import { describe, expect, it } from 'vitest';
import { resolveNode } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { cloneJson, isObject } from '../resolve/merge.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import { createLogicEngine, createLogicIndex, readLogic } from './index.js';
import type { LogicDocument, LogicFailure, LogicHost, LogicWrite } from './index.js';

/**
 * The rules Magnetic's Save a record writes (docs/design/magnetic-editor-links-and-presses.md, case 5), run as the
 * engine runs them: a rule on the button's `pressed` saves, and a rule on the accepted result clears and goes on
 */

function shapeOf(definition: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', commands: [], ...definition }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const LIBRARY: ComponentLibrary = Object.freeze({
    page: { tier: 'root', tag: 'ui-page', shape: shapeOf({ properties: {}, events: [] }) },
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({ properties: {}, events: [] }) },
    form: { tier: 'root', tag: 'ui-form', shape: shapeOf({ properties: {}, events: [], commands: ['reset'] }) },
    button: { tier: 'root', tag: 'ui-button', shape: shapeOf({ properties: { pressed: { type: 'object', default: {} } }, events: ['press'], '@transient': ['pressed'] }) },
    textField: { tier: 'root', tag: 'ui-text-field', shape: shapeOf({ properties: { value: { type: 'string', default: '' } }, events: ['change'] }) },
    numberField: { tier: 'root', tag: 'ui-number-field', shape: shapeOf({ properties: { value: { type: ['number', 'string'], default: '' } }, events: ['change'] }) }
});

type Screens = Record<string, Node>;

/** Home holds the fields and Add book by `@id`, as the editor names them; About is empty */
const SCREENS: Screens = Object.freeze({
    home: {
        component: 'panel',
        children: {
            textField: { component: 'textField', '@id': 'title' },
            numberField: { component: 'numberField', '@id': 'pages' },
            button: { component: 'button', '@id': 'addBook' }
        }
    },
    about: { component: 'panel' }
}) as unknown as Screens;

const HOME = '$.screens.home.children';

/** The clear of the result rule */
const CLEAR: JsonValue[] = [{ command: 'set', target: '#title.value', value: '' }];

function saveRules(value: JsonValue, then: JsonValue[]): LogicDocument {
    return {
        rules: {
            addBookPressed: { when: { path: '#addBook.pressed' }, do: [{ command: 'save-data', into: '$.data.books', value, as: 'addBookSaved', await: 'applied' }] },
            addBookSaved: { when: { result: 'addBookSaved', is: 'accepted' }, do: then }
        }
    } as unknown as LogicDocument;
}

function walk(state: JsonValue, path: string): JsonValue | undefined {
    let current: JsonValue | undefined = state;
    for (const step of path.slice(2).split('.')) {
        if (!isObject(current)) return undefined;
        current = current[step];
    }
    return current;
}

/** A host over plain JSON; its index looks a name up in the screen `$.route` shows first, as a browser or an app server does */
function host(screens: Screens = SCREENS) {
    const state = { root: { data: { books: {} }, route: { screen: 'home' }, screens: {} } as JsonValue };
    const failures: LogicFailure[] = [];
    const get = (path: string): JsonValue | undefined => walk(state.root, path);
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
    const trees = Object.fromEntries(
        Object.entries(screens).map(([name, root]) => {
            const resolved = resolveNode(cloneJson(root as unknown as JsonValue) as unknown as Node, LIBRARY, {}, { path: `$.screens.${name}` });
            return [name, { node: resolved.node, instances: resolved.instances }];
        })
    );
    const index = createLogicIndex(resolveNode({ component: 'page' } as Node, LIBRARY, {}), LIBRARY, undefined, { trees, current: () => get('$.route.screen') as string | undefined });
    const logicHost: LogicHost = {
        get,
        commit: (writes) => writes.forEach(apply),
        resolve: index.resolve,
        fields: index.fields,
        initial: index.initial,
        screens: () => ({ home: {}, about: {} }),
        failed: (failure) => failures.push(failure)
    };
    return { host: logicHost, index, failures, get, apply };
}

type Memory = ReturnType<typeof host>;
type Engine = ReturnType<typeof createLogicEngine>;

/** A person's change, as a host hands it to the engine */
function type(memory: Memory, engine: Engine, path: string, value: JsonValue): void {
    const previous = memory.get(path);
    memory.apply({ path, value });
    engine.changes([{ path, value, ...(previous !== undefined && { previous }), explicit: true }]);
}

function press(memory: Memory, engine: Engine, at = 1): void {
    type(memory, engine, `${HOME}.button.pressed`, { at, device: 'd1' });
}

function saved(memory: Memory): JsonValue[] {
    return Object.values((memory.get('$.data.books') ?? {}) as JsonObject);
}

describe('Save a record: the rules the editor writes', () => {
    it("should save the field's value read through its name, then clear the field and go to the screen of the result rule", () => {
        // Arrange
        const memory = host();
        const engine = createLogicEngine(
            saveRules({ title: '#title.value' }, [
                { command: 'set', target: '#title.value', value: '' },
                { command: 'navigate', target: 'about' }
            ]),
            memory.host
        );
        engine.start();
        type(memory, engine, `${HOME}.textField.value`, 'Persuasion');

        // Act
        press(memory, engine);

        // Assert
        expect(memory.failures).toEqual([]);
        expect(saved(memory)).toEqual([{ title: 'Persuasion' }]);
        expect(memory.get(`${HOME}.textField.value`)).toBe('');
        expect(memory.get('$.route.screen')).toBe('about');
    });

    it('should refuse a number source written as an expression that names a node, so the editor writes the plain reference', () => {
        // Arrange: an expression reads $. paths only; a #name in one does not compile
        const logic = saveRules({ title: '#title.value', pages: '{{ coalesce(#pages.value, null) }}' }, CLEAR);
        const plain = saveRules({ title: '#title.value', pages: '#pages.value' }, CLEAR);
        const { index } = host();

        // Act
        const refused = readLogic(logic, { resolve: index.resolve });
        const accepted = readLogic(plain, { resolve: index.resolve });

        // Assert
        expect(refused.errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-LOGIC-EXPRESSION', '$.logic.rules.addBookPressed.do.0.value.pages']]);
        expect(accepted.errors).toEqual([]);
    });

    it('should save an empty number source as "" and a typed one as its number', () => {
        // Arrange: the field holds its default, as a mounted number field does; the dataset's model refuses "" for a number field, so the editor gives a number source to a required field only
        const memory = host();
        const engine = createLogicEngine(saveRules({ title: '#title.value', pages: '#pages.value' }, CLEAR), memory.host);
        engine.start();
        type(memory, engine, `${HOME}.numberField.value`, '');
        type(memory, engine, `${HOME}.textField.value`, 'Emma');

        // Act
        press(memory, engine, 1);
        type(memory, engine, `${HOME}.textField.value`, 'Emma');
        type(memory, engine, `${HOME}.numberField.value`, 474);
        press(memory, engine, 2);

        // Assert
        expect(saved(memory)).toEqual([
            { title: 'Emma', pages: '' },
            { title: 'Emma', pages: 474 }
        ]);
    });

    it("should save a form's record keyed by its field children's keys and reset the form after", () => {
        // Arrange
        const screens = {
            ...SCREENS,
            home: {
                component: 'panel',
                children: {
                    entry: { component: 'form', children: { title: { component: 'textField' }, pages: { component: 'numberField' } } },
                    button: { component: 'button', '@id': 'addBook' }
                }
            }
        } as unknown as Screens;
        const memory = host(screens);
        const engine = createLogicEngine(saveRules({ form: '#entry' }, [{ command: 'reset', target: '#entry' }]), memory.host);
        engine.start();
        type(memory, engine, `${HOME}.entry.children.title.value`, 'Middlemarch');
        type(memory, engine, `${HOME}.entry.children.pages.value`, 880);

        // Act
        press(memory, engine);

        // Assert
        expect(memory.failures).toEqual([]);
        expect(saved(memory)).toEqual([{ title: 'Middlemarch', pages: 880 }]);
        expect(memory.get(`${HOME}.entry.children.title.value`)).toBe('');
    });

    it('should still save the typed value when the press also went to another screen first', () => {
        // Arrange: an `on` navigate runs in the browser at once, so $.route.screen changes before the press reaches the rule
        const memory = host();
        const engine = createLogicEngine(saveRules({ title: '#title.value' }, [{ command: 'set', target: '#title.value', value: '' }]), memory.host);
        engine.start();
        type(memory, engine, `${HOME}.textField.value`, 'Persuasion');

        // Act
        type(memory, engine, '$.route.screen', 'about');
        press(memory, engine);

        // Assert
        expect(memory.failures).toEqual([]);
        expect(saved(memory)).toEqual([{ title: 'Persuasion' }]);
        expect(memory.get(`${HOME}.textField.value`)).toBe('');
    });
});
