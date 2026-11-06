import { describe, expect, it } from 'vitest';
import { STORE_LIBRARY } from '../assemble/fixtures/storeApp.js';
import type { BuildError } from '../errors/index.js';
import { createLogicEngine, createLogicIndex, readLogic } from '../logic/index.js';
import type { LogicFailure, LogicHost, LogicWrite } from '../logic/index.js';
import { resolveNode } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { AppDocument, JsonObject, JsonValue, Node } from '../types.js';
import { validateDocument } from '../validate/index.js';
import { checkNavigate, routeTo } from './index.js';
import type { RouteScreens } from './index.js';

function shapeOf(properties: Record<string, unknown>, events: string[]): Shape {
    const result = parseShape({ summary: 'Test', properties, events, commands: [] }, 'test.state.json');
    if (result.shape === undefined) throw new Error('fixture shape');
    return result.shape;
}

const LIBRARY: ComponentLibrary = Object.freeze({
    ...STORE_LIBRARY,
    button: { tier: 'root', tag: 'ui-button', shape: shapeOf({ pressed: { type: 'boolean', default: false } }, ['press']) }
});

/** `home` takes no params; `product` takes a required `id` and an optional integer `qty` with a default */
const SCREENS: RouteScreens = Object.freeze({
    home: Object.freeze({}),
    product: Object.freeze({
        params: Object.freeze({
            id: Object.freeze({ type: 'string', required: true }),
            qty: Object.freeze({ type: 'integer', default: 1, validators: Object.freeze({ range: Object.freeze({ min: 1 }) }) })
        })
    })
});

const DOCUMENT = Object.freeze({
    app: { component: 'page', children: { title: { component: 'text' }, banner: { component: 'text' }, main: { component: 'outlet' } } },
    screens: {
        home: { title: 'Home', root: { component: 'panel', children: { title: { component: 'text' }, go: { component: 'button' } } } },
        product: { title: 'Product', params: SCREENS['product']?.params, root: { component: 'panel' } }
    },
    start: 'home',
    data: { pick: '' }
}) as unknown as JsonObject;

/** The document with `value` written at the dotted `path` */
function documentWith(path: string, value: JsonValue): JsonObject {
    const copy = JSON.parse(JSON.stringify(DOCUMENT)) as JsonObject;
    const keys = path.split('.');
    const last = keys.pop() as string;
    let parent = copy as Record<string, JsonValue>;
    for (const key of keys) parent = parent[key] as Record<string, JsonValue>;
    parent[last] = value;
    return copy;
}

function codesAndPaths(errors: readonly BuildError[]): string[] {
    return errors.map((error) => `${error.code} ${error.statePath ?? ''}`);
}

/** A host over a plain map of paths, which records commits and failures */
function memoryHost(screens: RouteScreens | undefined) {
    const values = new Map<string, JsonValue>([['$.data.pick', '']]);
    const commits: LogicWrite[][] = [];
    const failures: LogicFailure[] = [];
    const host: LogicHost = {
        get: (path) => values.get(path),
        commit: (writes) => {
            commits.push(writes.map((write) => ({ ...write })));
            for (const write of writes) if (write.value !== undefined) values.set(write.path, write.value);
        },
        failed: (failure) => failures.push(failure),
        ...(screens === undefined ? {} : { screens: () => screens })
    };
    return { host, values, commits, failures };
}

describe('routeTo', () => {
    it('should lay the given params over the defaults of the screen', () => {
        expect(routeTo(SCREENS, 'product', { id: 'p2' })).toEqual({ screen: 'product', params: { id: 'p2', qty: 1 } });
        expect(routeTo(SCREENS, 'home', undefined)).toEqual({ screen: 'home', params: {} });
    });

    it('should refuse an unknown screen with the nearest names, and any screen in an app without screens', () => {
        expect(routeTo(SCREENS, 'prodcut', {})).toEqual({ reason: 'no screen is named "prodcut"; nearest: product' });
        expect(routeTo(undefined, 'home', {})).toEqual({ reason: 'the app has no screens, so it cannot navigate to "home"' });
    });

    it('should refuse params that are not declared, do not fit, fail validators or leave a required one out', () => {
        expect(routeTo(SCREENS, 'product', { id: 'p2', colour: 'red' })).toEqual({ reason: 'param "colour" is not declared on screen "product"' });
        expect(routeTo(SCREENS, 'product', { id: 2 })).toEqual({ reason: 'param "id" must be string on screen "product"' });
        expect(routeTo(SCREENS, 'product', { id: 'p2', qty: 0 })).toEqual({ reason: 'param "qty" fails its validators on screen "product"' });
        expect(routeTo(SCREENS, 'product', {})).toEqual({ reason: 'param "id" of screen "product" is required' });
        expect(routeTo(SCREENS, 'product', 'p2')).toEqual({ reason: 'the params of navigate must be an object' });
    });

    it('should copy the given params, so the route shares nothing with the command', () => {
        const given = { id: 'p2', tags: ['a'] } as JsonObject;
        const declared: RouteScreens = { product: { params: { id: { type: 'string' }, tags: { type: 'array' } } } };

        const route = routeTo(declared, 'product', given) as { params: JsonObject };
        (route.params['tags'] as JsonValue[]).push('b');

        expect(given['tags']).toEqual(['a']);
    });
});

describe('checkNavigate', () => {
    it('should check literal params and only the names of params known when the command runs', () => {
        expect(checkNavigate(SCREENS, 'product', { id: '$row.id' })).toBeUndefined();
        expect(checkNavigate(SCREENS, 'product', { code: '$row.id' })?.code).toBe('SUI-ROUTE-PARAMS');
        expect(checkNavigate(SCREENS, 'product', { id: 'p1', qty: 'two' })?.code).toBe('SUI-ROUTE-PARAMS');
        expect(checkNavigate(SCREENS, 'product', undefined)?.reason).toBe('param "id" of screen "product" is required');
        expect(checkNavigate(SCREENS, '{{ $trigger }}', { id: 3 })).toBeUndefined();
        expect(checkNavigate(SCREENS, 'cart', {})?.code).toBe('SUI-ROUTE-SCREEN');
    });
});

describe('navigate in the logic engine', () => {
    const logic = Object.freeze({
        rules: { open: { when: { path: '$.data.pick' }, do: [{ command: 'navigate', target: 'product', value: { id: '{{ $trigger }}' } }] } }
    }) as unknown as JsonObject;

    it('should write screen and params to $.route in one commit', () => {
        // Arrange
        const { host, values, commits } = memoryHost(SCREENS);
        const engine = createLogicEngine(readLogic(logic).logic, host);

        // Act
        values.set('$.data.pick', 'p2');
        engine.changes([{ path: '$.data.pick', value: 'p2' }]);

        // Assert
        expect(commits).toEqual([[{ path: '$.route', value: { screen: 'product', params: { id: 'p2', qty: 1 } } }]]);
    });

    it('should fail with the reason and write nothing for an unknown screen or params that do not fit', () => {
        // Arrange
        const unknown = memoryHost({ home: {} });
        const misfit = memoryHost(SCREENS);
        const zero = readLogic({
            rules: { open: { when: { path: '$.data.pick' }, do: [{ command: 'navigate', target: 'product', value: { id: '{{ $trigger }}', qty: 0 } }] } }
        }).logic;

        // Act
        createLogicEngine(readLogic(logic).logic, unknown.host).changes([{ path: '$.data.pick', value: 'p2' }]);
        createLogicEngine(zero, misfit.host).changes([{ path: '$.data.pick', value: 'p2' }]);

        // Assert
        expect(unknown.commits).toEqual([]);
        expect(unknown.failures.map((failure) => failure.reason)).toEqual(['no screen is named "product"']);
        expect(misfit.commits).toEqual([]);
        expect(misfit.failures.map((failure) => failure.reason)).toEqual(['param "qty" fails its validators on screen "product"']);
    });

    it('should fail in a host without screens', () => {
        const { host, commits, failures } = memoryHost(undefined);

        createLogicEngine(readLogic(logic).logic, host).changes([{ path: '$.data.pick', value: 'p2' }]);

        expect(commits).toEqual([]);
        expect(failures[0]?.reason).toBe('the app has no screens, so it cannot navigate to "product"');
    });

    it('should read navigate with a target that is a screen name, and triggers on $.route and $.screens', () => {
        const read = readLogic({
            rules: {
                back: { when: { path: '$.route.screen', is: 'cart' }, do: [{ command: 'navigate', target: 'home' }] },
                seen: { when: { path: '$.screens.home.children.go.pressed' }, do: [{ command: 'set', target: '$.data.pick', value: 'x' }] },
                bad: { when: { path: '$.data.pick' }, do: [{ command: 'navigate', value: {} }] }
            }
        });

        expect(read.errors.map((error) => error.statePath)).toEqual(['$.logic.rules.bad.do.0']);
    });
});

describe('the document check of navigate', () => {
    it('should report SUI-ROUTE-SCREEN and SUI-ROUTE-PARAMS in on entries of screens and the shell', () => {
        const document = documentWith('screens.home.root.children.go.on', {
            press: [
                { command: 'navigate', target: 'product', value: { id: 'p1' } },
                { command: 'navigate', target: 'cart' },
                { command: 'navigate', target: 'product', value: { id: 7 } }
            ]
        });

        const errors = validateDocument(document, LIBRARY).errors;

        expect(codesAndPaths(errors)).toEqual([
            'SUI-ROUTE-SCREEN $.screens.home.children.go.on.press.1',
            'SUI-ROUTE-PARAMS $.screens.home.children.go.on.press.2'
        ]);
    });

    it('should report navigate commands of the logic and a navigate in an app without screens', () => {
        const withLogic = documentWith('logic', { rules: { open: { when: { path: '$.data.pick' }, do: [{ command: 'navigate', target: 'product', value: { qty: 2 } }] } } });
        const single = { app: { component: 'panel', children: { go: { component: 'button', on: { press: { command: 'navigate', target: 'home' } } } } } };

        expect(codesAndPaths(validateDocument(withLogic, LIBRARY).errors)).toEqual(['SUI-ROUTE-PARAMS $.logic.rules.open.do.0']);
        expect(codesAndPaths(validateDocument(single, LIBRARY).errors)).toEqual(['SUI-ROUTE-SCREEN $.app.children.go.on.press']);
    });

    it('should read a $.screens path as a node path in its own screen and as a state path in the shell', () => {
        const inScreen = documentWith('screens.home.root.children.go.on', { press: { command: 'set', target: '$.screens.home.children.go.nope', value: 1 } });
        const inShell = documentWith('app.children.go', { component: 'button', on: { press: { command: 'set', target: '$.screens.home.children.go.nope', value: 1 } } });

        expect(codesAndPaths(validateDocument(inScreen, LIBRARY).errors)).toEqual(['SUI-ON-TARGET $.screens.home.children.go.on.press']);
        expect(codesAndPaths(validateDocument(inShell, LIBRARY).errors)).toEqual([]);
    });

    it('should check the screen a link or menu item names, with its params, in the shell and the screens', () => {
        // Arrange
        const library: ComponentLibrary = {
            ...LIBRARY,
            link: { tier: 'root', tag: 'ui-link', shape: shapeOf({ screen: { type: 'string', default: '' }, params: { type: 'object', default: {} } }, ['press']) }
        };
        const shell = documentWith('app.children.banner', { component: 'link', screen: 'prodcut' });
        const params = documentWith('screens.home.root.children.go', { component: 'link', screen: 'product', params: { qty: 2 } });
        const good = documentWith('screens.home.root.children.go', { component: 'link', screen: 'product', params: { id: 'p1' } });
        const empty = documentWith('app.children.banner', { component: 'link', screen: '' });

        // Act / Assert
        const shellErrors = validateDocument(shell, library).errors;
        expect(codesAndPaths(shellErrors)).toEqual(['SUI-ROUTE-SCREEN $.app.children.banner.screen']);
        expect(shellErrors[0]?.message).toContain('product');
        expect(codesAndPaths(validateDocument(params, library).errors)).toEqual(['SUI-ROUTE-PARAMS $.screens.home.children.go.params']);
        expect(validateDocument(good, library).errors).toEqual([]);
        expect(validateDocument(empty, library).errors).toEqual([]);
    });

    it('should report a navigate without target as a malformed on entry', () => {
        const document = documentWith('screens.home.root.children.go.on', { press: { command: 'navigate' } });

        expect(codesAndPaths(validateDocument(document, LIBRARY).errors)).toContain('SUI-ON-SHAPE $.screens.home.children.go.on.press');
    });
});

describe('^key in a logic index with screens', () => {
    const app = DOCUMENT as unknown as AppDocument;
    const shell = resolveNode(app.app as Node, LIBRARY, {});
    const home = resolveNode(app.screens?.['home']?.root as Node, LIBRARY, {}, { path: '$.screens.home' });
    const trees = { home: { node: home.node, instances: home.instances } };

    it('should find the node of the current screen before the shell, and a key only in the shell in the shell', () => {
        const index = createLogicIndex(shell, LIBRARY, undefined, { trees, current: () => 'home' });

        expect(index.resolve('^title')).toBe('$.screens.home.children.title');
        expect(index.resolve('^banner')).toBe('$.app.children.banner');
    });

    it('should prefer the shell without a current screen, and find a key only in a screen there', () => {
        const index = createLogicIndex(shell, LIBRARY, undefined, { trees });
        const elsewhere = createLogicIndex(shell, LIBRARY, undefined, { trees, current: () => 'product' });

        expect(index.resolve('^title')).toBe('$.app.children.title');
        expect(index.resolve('^go')).toBe('$.screens.home.children.go');
        expect(elsewhere.resolve('^title')).toBe('$.app.children.title');
    });
});
