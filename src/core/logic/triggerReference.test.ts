import { describe, expect, it } from 'vitest';
import { resolveNode } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { cloneJson, isObject } from '../resolve/merge.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import { validateDocument } from '../validate/index.js';
import { createLogicEngine, createLogicIndex, logicRunOrder, readLogic, readModule } from './index.js';
import type { LogicDocument, LogicFailure, LogicHost, LogicWrite } from './index.js';

function shapeOf(definition: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', commands: [], ...definition }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

/** `button` declares `pressed` as the library's button does: stored state, an object, transient */
const LIBRARY: ComponentLibrary = Object.freeze({
    page: { tier: 'root', tag: 'ui-page', shape: shapeOf({ properties: {}, events: [] }) },
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({ properties: {}, events: [] }) },
    button: { tier: 'root', tag: 'ui-button', shape: shapeOf({ properties: { pressed: { type: 'object', default: {} } }, events: ['press'], '@transient': ['pressed'] }) },
    textField: { tier: 'root', tag: 'ui-text-field', shape: shapeOf({ properties: { value: { type: 'string', default: '' } }, events: ['change'] }) }
});

type Screens = Record<string, Node>;

const APP = Object.freeze({ component: 'page' }) as Node;

/** A home screen with a button named by its key, and an about screen with a button named by its `@id` */
const SCREENS: Screens = Object.freeze({
    home: { component: 'panel', children: { addBook: { component: 'button' }, title: { component: 'textField' } } },
    about: { component: 'panel', children: { button: { component: 'button', '@id': 'back' } } }
}) as unknown as Screens;

/** Counts the presses of `#addBook` */
const COUNT_PRESSES: LogicDocument = Object.freeze({
    rules: { addBookPressed: { when: { path: '#addBook.pressed' }, do: [{ command: 'increment', target: '$.data.presses' }] } }
}) as LogicDocument;

function walk(state: JsonValue, path: string): JsonValue | undefined {
    let current: JsonValue | undefined = state;
    for (const step of path.slice(2).split('.')) {
        if (!isObject(current) && !Array.isArray(current)) return undefined;
        current = (current as Record<string, JsonValue>)[step];
    }
    return current;
}

function indexOf(screens: Screens, current?: () => string | undefined, app: Node = APP) {
    const trees = Object.fromEntries(
        Object.entries(screens).map(([name, root]) => {
            const resolved = resolveNode(cloneJson(root as unknown as JsonValue) as unknown as Node, LIBRARY, {}, { path: `$.screens.${name}` });
            return [name, { node: resolved.node, instances: resolved.instances }];
        })
    );
    return createLogicIndex(resolveNode(cloneJson(app as unknown as JsonValue) as unknown as Node, LIBRARY, {}), LIBRARY, undefined, { trees, ...(current && { current }) });
}

/** A host over plain JSON whose index looks a name up as a browser or an app server does: in the screen `$.route` shows first */
function screenHost(screens: Screens, screen: string, app: Node = APP) {
    const state = { root: { data: { presses: 0 }, route: { screen }, screens: {} } as JsonValue };
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
    const index = indexOf(screens, () => get('$.route.screen') as string | undefined, app);
    const host: LogicHost = {
        get,
        commit: (writes) => writes.forEach(apply),
        resolve: index.resolve,
        failed: (failure) => failures.push(failure)
    };
    return { host, failures, get, apply };
}

type Memory = ReturnType<typeof screenHost>;
type Engine = ReturnType<typeof createLogicEngine>;

/** A press as the button writes it: `pressed` set to the time and the device, a change every time */
function press(memory: Memory, engine: Engine, path: string, at: number): void {
    const previous = memory.get(`${path}.pressed`);
    const value = { at, device: 'd1' };
    memory.apply({ path: `${path}.pressed`, value });
    engine.changes([{ path: `${path}.pressed`, value, ...(previous !== undefined && { previous }), explicit: true }]);
}

/** A person's change of `$.route.screen`, as a host hands it to the engine */
function show(memory: Memory, engine: Engine, screen: string): void {
    const previous = memory.get('$.route.screen') as JsonValue;
    memory.apply({ path: '$.route.screen', value: screen });
    engine.changes([{ path: '$.route.screen', value: screen, previous }]);
}

describe('readLogic: a trigger path that is a node reference', () => {
    it('should keep a rule and a machine transition whose trigger names one node, by key or by @id', () => {
        // Arrange
        const index = indexOf(SCREENS);
        const logic = {
            rules: { addBookPressed: { when: { path: '#addBook.pressed' }, do: [{ command: 'increment', target: '$.data.presses' }] } },
            machines: { visit: { state: '$.data.visit', initial: 'reading', transitions: [{ from: 'reading', when: { path: '#back.pressed' }, to: 'left' }] } }
        };

        // Act
        const result = readLogic(logic, { resolve: index.resolve, explain: index.explain });

        // Assert
        expect(result.errors).toEqual([]);
        expect(result.logic.rules?.['addBookPressed']?.when.path).toBe('#addBook.pressed');
        expect(result.logic.machines?.['visit']?.transitions[0]?.when.path).toBe('#back.pressed');
    });

    it('should refuse a trigger whose name no node has, and say so', () => {
        // Arrange
        const index = indexOf(SCREENS);
        const logic = { rules: { gone: { when: { path: '#removeBook.pressed' }, do: [{ command: 'increment', target: '$.data.presses' }] } } };

        // Act
        const result = readLogic(logic, { resolve: index.resolve, explain: index.explain });

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-LOGIC-PATH', '$.logic.rules.gone.when.path']]);
        expect(result.errors[0]?.message).toContain('#removeBook.pressed (no node is named "removeBook")');
        expect(result.logic).toEqual({});
    });

    it('should refuse a trigger on a property its node links, and name the link target', () => {
        // Arrange: a write to a linked property is reported at the link's target, never at the node's path
        const screens = { home: { component: 'panel', children: { title: { component: 'textField', '<-value': '$.data.draft' }, plain: { component: 'textField' } } } } as unknown as Screens;
        const index = indexOf(screens);
        const logic = {
            rules: {
                linked: { when: { path: '#title.value' }, do: [{ command: 'increment', target: '$.data.presses' }] },
                locked: { when: { path: '#title.value' }, do: [{ command: 'reject', reason: 'fixed' }] },
                plain: { when: { path: '#plain.value' }, do: [{ command: 'increment', target: '$.data.presses' }] },
                writes: { when: { path: '$.data.go' }, do: [{ command: 'set', target: '#title.value', value: '' }] }
            }
        };

        // Act
        const result = readLogic(logic, { resolve: index.resolve, explain: index.explain, linked: index.linked });

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-LOGIC-PATH', '$.logic.rules.linked.when.path'],
            ['SUI-LOGIC-PATH', '$.logic.rules.locked.when.path']
        ]);
        expect(result.errors[0]?.message).toContain('#title.value (the node links this property to $.data.draft; a trigger names that path)');
        expect(Object.keys(result.logic.rules ?? {})).toEqual(['plain', 'writes']);
    });

    it('should refuse a trigger whose name two nodes have, and name both', () => {
        // Arrange: a key of the home screen is the @id of a node of the about screen
        const screens = { ...SCREENS, about: { component: 'panel', children: { button: { component: 'button', '@id': 'addBook' } } } } as unknown as Screens;
        const index = indexOf(screens);

        // Act
        const result = readLogic(COUNT_PRESSES, { resolve: index.resolve, explain: index.explain });

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([['SUI-LOGIC-PATH', '$.logic.rules.addBookPressed.when.path']]);
        expect(result.errors[0]?.message).toContain('2 nodes are named "addBook": $.screens.about.children.button, $.screens.home.children.addBook');
        expect(result.logic).toEqual({});
    });

    it('should refuse a trigger reference with a capture, a star or a template, whatever resolves', () => {
        // Arrange
        const rule = (path: string) => ({ when: { path }, do: [{ command: 'increment', target: '$.data.presses' }] });
        const logic = { rules: { capture: rule('#addBook.{property}'), star: rule('#addBook.*'), template: rule('#{{ $.data.name }}.pressed'), bare: rule('#') } };

        // Act
        const result = readLogic(logic, { resolve: () => '$.screens.home.children.addBook.pressed' });

        // Assert
        expect(result.errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-LOGIC-PATH', '$.logic.rules.capture.when.path'],
            ['SUI-LOGIC-PATH', '$.logic.rules.star.when.path'],
            ['SUI-LOGIC-PATH', '$.logic.rules.template.when.path'],
            ['SUI-LOGIC-PATH', '$.logic.rules.bare.when.path']
        ]);
        expect(result.logic).toEqual({});
    });

    it('should accept a trigger reference in a document with screens and refuse one that names nothing', () => {
        // Arrange
        const screens = Object.fromEntries(Object.entries(SCREENS).map(([name, root]) => [name, { root }]));
        const valid = { app: APP, screens, start: 'home', data: { presses: 0 }, logic: COUNT_PRESSES };
        const invalid = { ...valid, logic: { rules: { r: { when: { path: '#nobody.pressed' }, do: [{ command: 'increment', target: '$.data.presses' }] } } } };

        // Act
        const ok = validateDocument(valid, LIBRARY).errors.filter((error) => error.code.startsWith('SUI-LOGIC'));
        const bad = validateDocument(invalid, LIBRARY).errors.filter((error) => error.code.startsWith('SUI-LOGIC'));

        // Assert
        expect(ok).toEqual([]);
        expect(bad.map((error) => [error.code, error.statePath])).toEqual([['SUI-LOGIC-PATH', '$.logic.rules.r.when.path']]);
    });

    it('should refuse a logic module whose trigger names a node', () => {
        // Arrange
        const module = { needs: { books: {} }, rules: { r: { when: { path: '#addBook.pressed' }, do: [{ command: 'set', target: '$.data.books.last', value: 1 }] } } };

        // Act
        const errors = readModule(module).errors;

        // Assert
        expect(errors.map((error) => [error.code, error.statePath])).toContainEqual(['SUI-MODULE-NODE', '$.rules.r.when.path']);
    });
});

describe('createLogicEngine: a trigger path that is a node reference', () => {
    it('should run a rule on each press of the button it names on the screen shown', () => {
        // Arrange
        const memory = screenHost(SCREENS, 'home');
        const engine = createLogicEngine(COUNT_PRESSES, memory.host);
        engine.start();

        // Act
        press(memory, engine, '$.screens.home.children.addBook', 1);
        press(memory, engine, '$.screens.home.children.addBook', 2);

        // Assert
        expect(memory.get('$.data.presses')).toBe(2);
        expect(memory.failures).toEqual([]);
        expect(engine.trace().map((run) => run.events.map((event) => [event.name, event.outcome, event.path]))).toEqual([
            [['addBookPressed', 'fired', '$.screens.home.children.addBook.pressed']],
            [['addBookPressed', 'fired', '$.screens.home.children.addBook.pressed']]
        ]);
    });

    it('should run a rule on a press of a button of a screen that is not shown', () => {
        // Arrange: about shows, the button is on home (a second window, or a press that also navigated)
        const memory = screenHost(SCREENS, 'about');
        const engine = createLogicEngine(COUNT_PRESSES, memory.host);
        engine.start();

        // Act
        press(memory, engine, '$.screens.home.children.addBook', 1);

        // Assert
        expect(memory.get('$.data.presses')).toBe(1);
    });

    it('should not fire a press rule at start, and should ignore another node of the same component', () => {
        // Arrange
        const memory = screenHost(SCREENS, 'home');
        const engine = createLogicEngine(COUNT_PRESSES, memory.host);

        // Act
        engine.start();
        press(memory, engine, '$.screens.about.children.button', 1);

        // Assert
        expect(memory.get('$.data.presses')).toBe(0);
    });

    it('should not run a press rule that only sets a value when the engine starts or derives, and run it on a press', () => {
        // Arrange: set is a deriving command, and the button's pressed is {} before any press
        const logic = {
            rules: { openOnPress: { when: { path: '#addBook.pressed' }, do: [{ command: 'set', target: '$.data.opened', value: true }] } }
        } as unknown as LogicDocument;
        const memory = screenHost(SCREENS, 'home');
        memory.apply({ path: '$.screens.home.children.addBook.pressed', value: {} });
        const engine = createLogicEngine(logic, memory.host);

        // Act
        engine.start();
        engine.derive();
        const atStart = memory.get('$.data.opened');
        press(memory, engine, '$.screens.home.children.addBook', 1);

        // Assert
        expect(atStart).toBeUndefined();
        expect(engine.trace().map((run) => run.cause)).toEqual(['change']);
        expect(memory.get('$.data.opened')).toBe(true);
    });

    it('should move a machine on a transition whose trigger is a node reference', () => {
        // Arrange
        const logic = { machines: { visit: { state: '$.data.visit', initial: 'reading', transitions: [{ from: 'reading', when: { path: '#back.pressed' }, to: 'left' }] } } } as unknown as LogicDocument;
        const memory = screenHost(SCREENS, 'home');
        const engine = createLogicEngine(logic, memory.host);
        engine.start();

        // Act
        press(memory, engine, '$.screens.about.children.button', 1);

        // Assert
        expect(memory.get('$.data.visit')).toBe('left');
    });

    it('should keep firing when the node sits elsewhere in the tree of a changed document', () => {
        // Arrange: the document changed, so its host made a new engine; the button moved into a panel
        const moved = { ...SCREENS, home: { component: 'panel', children: { tools: { component: 'panel', children: { addBook: { component: 'button' } } } } } } as unknown as Screens;
        const memory = screenHost(moved, 'home');
        const engine = createLogicEngine(COUNT_PRESSES, memory.host);
        engine.start();

        // Act
        press(memory, engine, '$.screens.home.children.tools.children.addBook', 1);
        press(memory, engine, '$.screens.home.children.addBook', 2);

        // Assert: the new path fires, the path the node left does not
        expect(memory.get('$.data.presses')).toBe(1);
    });

    it('should resolve the reference again when the screen shown changes, and not listen to the node of the screen that was left', () => {
        // Arrange: both screens have a node named save, so the name means the one of the screen shown
        const screens = {
            home: { component: 'panel', children: { save: { component: 'button' } } },
            about: { component: 'panel', children: { save: { component: 'button' } } }
        } as unknown as Screens;
        const logic = { rules: { saved: { when: { path: '#save.pressed' }, do: [{ command: 'increment', target: '$.data.presses' }] } } } as unknown as LogicDocument;
        const memory = screenHost(screens, 'home');
        const engine = createLogicEngine(logic, memory.host);
        engine.start();

        // Act
        press(memory, engine, '$.screens.home.children.save', 1);
        const onHome = memory.get('$.data.presses');
        show(memory, engine, 'about');
        press(memory, engine, '$.screens.home.children.save', 2);
        const stale = memory.get('$.data.presses');
        press(memory, engine, '$.screens.about.children.save', 3);

        // Assert
        expect(onHome).toBe(1);
        expect(stale).toBe(1);
        expect(memory.get('$.data.presses')).toBe(2);
        expect(memory.failures).toEqual([]);
    });

    it('should resolve the reference again after a navigate of its own chain', () => {
        // Arrange: the press on home navigates to about; the next press is of the about screen's node
        const screens = {
            home: { component: 'panel', children: { save: { component: 'button' } } },
            about: { component: 'panel', children: { save: { component: 'button' } } }
        } as unknown as Screens;
        const logic = {
            rules: { saved: { when: { path: '#save.pressed' }, do: [{ command: 'increment', target: '$.data.presses' }, { command: 'navigate', target: 'about' }] } }
        } as unknown as LogicDocument;
        const memory = screenHost(screens, 'home');
        const engine = createLogicEngine(logic, { ...memory.host, screens: () => ({ home: {}, about: {} }) });
        engine.start();

        // Act
        press(memory, engine, '$.screens.home.children.save', 1);
        press(memory, engine, '$.screens.about.children.save', 2);

        // Assert
        expect(memory.get('$.route.screen')).toBe('about');
        expect(memory.get('$.data.presses')).toBe(2);
    });

    it('should report a reference that finds no node once, with its code and no value, and listen to nothing', () => {
        // Arrange
        const logic = { rules: { gone: { when: { path: '#removeBook.pressed' }, do: [{ command: 'increment', target: '$.data.presses' }] } } } as unknown as LogicDocument;
        const memory = screenHost(SCREENS, 'home');

        // Act
        const engine = createLogicEngine(logic, memory.host);
        engine.start();
        press(memory, engine, '$.screens.home.children.addBook', 1);
        show(memory, engine, 'about');
        press(memory, engine, '$.screens.about.children.button', 2);

        // Assert
        expect(memory.get('$.data.presses')).toBe(0);
        expect(memory.failures).toHaveLength(1);
        expect(memory.failures[0]).toMatchObject({ kind: 'rule', name: 'gone' });
        expect(memory.failures[0]?.reason).toContain('SUI-LOGIC-PATH: Path #removeBook.pressed at $.logic.rules.gone.when.path');
        expect(memory.failures[0]?.reason).not.toContain('d1');
    });

    it('should report a reference that two nodes of the screen shown share, and listen again where one node has the name', () => {
        // Arrange: home has one save, about has two
        const screens = {
            home: { component: 'panel', children: { save: { component: 'button' } } },
            about: { component: 'panel', children: { save: { component: 'button' }, other: { component: 'button', '@id': 'save' } } }
        } as unknown as Screens;
        const logic = { rules: { saved: { when: { path: '#save.pressed' }, do: [{ command: 'increment', target: '$.data.presses' }] } } } as unknown as LogicDocument;
        const memory = screenHost(screens, 'home');
        const engine = createLogicEngine(logic, memory.host);
        engine.start();

        // Act
        show(memory, engine, 'about');
        press(memory, engine, '$.screens.about.children.save', 1);
        const failuresOnAbout = memory.failures.length;
        show(memory, engine, 'home');
        press(memory, engine, '$.screens.home.children.save', 2);

        // Assert
        expect(failuresOnAbout).toBe(1);
        expect(memory.failures.map((failure) => failure.name)).toEqual(['saved']);
        expect(memory.get('$.data.presses')).toBe(1);
    });

    it('should ask a guard whose trigger is a node reference', () => {
        // Arrange
        const logic = { rules: { locked: { when: { path: '#title.value' }, do: [{ command: 'reject', reason: 'The title is fixed' }] } } } as unknown as LogicDocument;
        const memory = screenHost(SCREENS, 'home');
        const engine = createLogicEngine(logic, memory.host);

        // Act
        const refused = engine.guard({ path: '$.screens.home.children.title.value', value: 'Emma' });
        const other = engine.guard({ path: '$.screens.home.children.addBook.pressed', value: { at: 1, device: 'd1' } });

        // Assert
        expect(refused).toBe('The title is fixed');
        expect(other).toBeUndefined();
        expect(engine.names).toEqual(['locked']);
    });

    it('should list a unit with a reference trigger in the run order without a state path it cannot know', () => {
        // Act
        const order = logicRunOrder(COUNT_PRESSES);

        // Assert
        expect(order).toEqual([{ kind: 'rule', name: 'addBookPressed', position: 1, reads: [], writes: ['$.data.presses'] }]);
    });

    it('should list no read for a guard whose trigger is a node reference, and the path of one that names a state path', () => {
        // Arrange
        const logic = {
            rules: {
                locked: { when: { path: '#title.value' }, do: [{ command: 'reject', reason: 'no' }] },
                frozen: { when: { path: '$.data.total' }, do: [{ command: 'reject', reason: 'no' }] }
            }
        } as unknown as LogicDocument;

        // Act
        const order = logicRunOrder(logic);

        // Assert
        expect(order).toEqual([
            { kind: 'guard', name: 'locked', reads: [], writes: [] },
            { kind: 'guard', name: 'frozen', reads: ['$.data.total'], writes: [] }
        ]);
    });
});
