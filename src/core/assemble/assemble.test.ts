import { describe, expect, it } from 'vitest';
import type { AppBlueprint } from '../blueprint/types.js';
import type { BuildError } from '../errors/index.js';
import { createLogicEngine } from '../logic/engine.js';
import type { LogicDocument, LogicHost, LogicWrite } from '../logic/types.js';
import { cloneJson, isObject } from '../resolve/merge.js';
import type { AppDocument, JsonObject, JsonValue } from '../types.js';
import { validateDocument } from '../validate/index.js';
import { STORE_APP, STORE_LIBRARY, STORE_PARTS } from './fixtures/storeApp.js';
import { assembleApp, nearestNames, validateApp } from './index.js';
import type { PartSource } from './index.js';

function copy<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function codesAndPaths(errors: readonly BuildError[]): string[] {
    return errors.map((error) => `${error.code} ${error.statePath ?? ''}`);
}

function walk(state: JsonValue, path: string): JsonValue | undefined {
    let current: JsonValue | undefined = state;
    for (const step of path.slice(2).split('.')) {
        if (!isObject(current)) return undefined;
        current = current[step];
    }
    return current;
}

/** Runs an assembled document's logic over its own state and writes the bag, as a person adding lines would */
function fillBag(document: AppDocument, bag: JsonObject): JsonObject {
    const state = cloneJson({ app: document.app, data: document.data ?? {} } as unknown as JsonValue) as JsonObject;
    const apply = (write: LogicWrite): void => {
        const steps = write.path.slice(2).split('.');
        let current = state;
        for (const step of steps.slice(0, -1)) {
            if (!isObject(current[step])) current[step] = {};
            current = current[step] as JsonObject;
        }
        current[steps[steps.length - 1] as string] = cloneJson(write.value as JsonValue);
    };
    const host: LogicHost = { get: (path) => walk(state, path), commit: (writes) => writes.forEach(apply), failed: () => undefined };
    const engine = createLogicEngine(document.logic as unknown as LogicDocument, host);
    apply({ path: '$.data.bag', value: bag });
    engine.changes([{ path: '$.data.bag', value: bag, previous: {} }]);
    return walk(state, '$.data.totals') as JsonObject;
}

const LINES = Object.freeze({ l1: Object.freeze({ product: 'p1', qty: 2, line: 60 }), l2: Object.freeze({ product: 'p2', qty: 1, line: 90 }) }) as unknown as JsonObject;

describe('assembleApp', () => {
    it('should build the store document from its parts with no errors', () => {
        const { document, errors } = assembleApp(STORE_APP, STORE_PARTS);

        expect(errors).toEqual([]);
        expect(document.app).toEqual(STORE_APP.shell);
        expect(Object.keys(document.screens ?? {})).toEqual(['home', 'product']);
        expect(document.start).toBe('home');
        expect(document.screens?.['product']?.params).toEqual({ id: { type: 'string', required: true } });
        expect(document.theme).toEqual({ tokens: { color: { brand: '#204080' } } });
        expect(document.themes).toEqual({ dark: { kind: 'mode', tokens: { color: { brand: '#8090c0' } } } });
        expect(document.data).toEqual({
            products: { p1: { name: 'Lamp', price: 30 }, p2: { name: 'Chair', price: 90 } },
            bag: {},
            totals: { net: 0, gross: 0, currency: 'USD' }
        });
        expect(Object.keys(document.logic?.['rules'] as JsonObject)).toEqual(['opened', 'cart:totals']);
        expect((document.logic?.['rules'] as JsonObject)['opened']).toEqual(STORE_APP.logic?.rules?.['opened']);
        expect(document.locales).toEqual(STORE_APP.locales);
    });

    it('should carry used owner components as bare trees with their exposes, and leave unused ones out', () => {
        const { document } = assembleApp(STORE_APP, STORE_PARTS);

        expect(Object.keys(document.composed ?? {}).sort()).toEqual(['brand-mark', 'product-card']);
        expect(document.composed?.['brand-mark']).toEqual({ component: 'text', _value: 'Store', exposes: { _value: 'The brand text' } });
        expect(document.composed?.['product-card']).not.toHaveProperty('exposes');
    });

    it('should list every part the app reads, once each', () => {
        const { uses } = assembleApp(STORE_APP, STORE_PARTS);

        expect(uses).toEqual([
            { kind: 'themes', name: 'store' },
            { kind: 'data', name: 'catalog' },
            { kind: 'models', name: 'product' },
            { kind: 'models', name: 'bag-line' },
            { kind: 'models', name: 'cart-totals' },
            { kind: 'logic', name: 'cart' },
            { kind: 'components', name: 'brand-mark' },
            { kind: 'components', name: 'product-card' }
        ]);
    });

    it('should start a persona binding as an empty map plus the model defaults and list its model', () => {
        const blueprint = copy(STORE_APP);
        blueprint.uses = { ...blueprint.uses, data: { ...blueprint.uses?.data, draft: { model: 'product', scope: 'persona' } } };

        const { document, uses, errors } = assembleApp(blueprint, STORE_PARTS);

        expect(errors).toEqual([]);
        expect(document.data?.['bag']).toEqual({});
        expect(document.data?.['draft']).toEqual({ price: 0 });
        expect(uses).toContainEqual({ kind: 'models', name: 'product' });
        expect(uses).not.toContainEqual({ kind: 'models', name: 'unused' });
    });

    it('should give two apps that use cart with different tax rates different derived totals', () => {
        const other = copy(STORE_APP);
        other.uses = { ...other.uses, logic: { cart: { params: { taxRate: 0.05, currency: 'USD' } } } };

        const eu = assembleApp(STORE_APP, STORE_PARTS);
        const us = assembleApp(other, STORE_PARTS);

        expect([...eu.errors, ...us.errors]).toEqual([]);
        expect(fillBag(eu.document, LINES)).toEqual({ net: 150, gross: 180, currency: 'EUR' });
        expect(fillBag(us.document, LINES)).toEqual({ net: 150, gross: 157.5, currency: 'USD' });
    });

    it('should report a need the app does not bind and a binding of another model, naming the module', () => {
        const blueprint = copy(STORE_APP);
        blueprint.uses = { ...blueprint.uses, data: { products: { dataset: 'catalog' }, bag: { dataset: 'catalog' } } };

        const { document, errors } = assembleApp(blueprint, STORE_PARTS);

        expect(codesAndPaths(errors)).toEqual(['SUI-USES-MODEL $.uses.data.bag', 'SUI-USES-NEEDS $.uses.data.totals']);
        expect(errors[0]?.message).toBe('The data binding "bag" at $.uses.data.bag holds records of the model "product", and the logic module "cart" needs the model "bag-line"');
        expect(errors[1]?.message).toBe('The logic module "cart" needs the data binding "totals", and the app binds none at $.uses.data.totals');
        expect(errors.map((error) => error.part)).toEqual([{ kind: 'logic', name: 'cart' }, { kind: 'logic', name: 'cart' }]);
        expect(Object.keys(document.logic?.['rules'] as JsonObject)).toEqual(['opened']);
    });

    it('should report a binding of a dataset with no model', () => {
        const blueprint = copy(STORE_APP);
        blueprint.uses = { ...blueprint.uses, data: { ...blueprint.uses?.data, bag: { dataset: 'orders' } } };

        const { errors } = assembleApp(blueprint, STORE_PARTS);

        expect(errors.map((error) => error.message)).toEqual([
            'The data binding "bag" at $.uses.data.bag holds records of no model, and the logic module "cart" needs the model "bag-line"'
        ]);
    });

    it('should report a param that fails its declaration with the module and param in its path', () => {
        const blueprint = copy(STORE_APP);
        blueprint.uses = { ...blueprint.uses, logic: { cart: { params: { taxRate: 2, currency: 'euro', tip: 1 } } } };

        const { document, errors } = assembleApp(blueprint, STORE_PARTS);

        expect(codesAndPaths(errors)).toEqual([
            'SUI-MODULE-PARAM $.uses.logic.cart.params.tip',
            'SUI-MODULE-PARAM $.uses.logic.cart.params.taxRate',
            'SUI-MODULE-PARAM $.uses.logic.cart.params.currency'
        ]);
        expect(errors[1]?.message).toBe('Param "taxRate" of the logic module at $.uses.logic.cart.params.taxRate: the value fails its validators');
        expect(document.logic?.['rules']).not.toHaveProperty('cart:totals');
    });

    it('should report two modules that need one name with different models, naming both', () => {
        const blueprint = copy(STORE_APP);
        blueprint.uses = { ...blueprint.uses, data: { ...blueprint.uses?.data, wishes: { model: 'product', scope: 'persona' } }, logic: { ...blueprint.uses?.logic, wishlist: {} } };
        const parts = copy(STORE_PARTS);
        (parts.modules as Record<string, unknown>)['wishlist'] = { needs: { bag: { model: 'product' } }, params: {} };

        const { errors } = assembleApp(blueprint, parts);

        expect(codesAndPaths(errors)).toEqual(['SUI-USES-MODEL $.uses.data.bag']);
        expect(errors[0]?.message).toBe(
            'The data binding "bag" at $.uses.data.bag is needed by the logic modules "cart" (model "bag-line") and "wishlist" (model "product"), which must name one model'
        );
        expect(errors[0]?.part).toEqual({ kind: 'logic', name: 'wishlist' });
    });

    it('should let two modules that need one name with one model share the binding', () => {
        const blueprint = copy(STORE_APP);
        blueprint.uses = { ...blueprint.uses, logic: { ...blueprint.uses?.logic, wishlist: {} } };
        const parts = copy(STORE_PARTS);
        (parts.modules as Record<string, unknown>)['wishlist'] = { needs: { bag: { model: 'bag-line' } }, params: {} };

        expect(assembleApp(blueprint, parts).errors).toEqual([]);
    });

    it('should carry every listed theme by name, and keep theme and themes the first one', () => {
        // Arrange
        const blueprint = copy(STORE_APP);
        blueprint.uses = { ...blueprint.uses, themes: ['plain', 'store'] };

        // Act
        const { document, uses } = assembleApp(blueprint, STORE_PARTS);

        // Assert
        expect(Object.keys(document.appThemes ?? {})).toEqual(['plain', 'store']);
        expect(document.appThemes?.['store']).toEqual(STORE_PARTS.themes?.['store']);
        expect(document.theme).toEqual({ tokens: {} });
        expect(document.themes).toBeUndefined();
        expect(uses.filter((part) => part.kind === 'themes').map((part) => part.name)).toEqual(['plain', 'store']);
    });

    it('should report a missing theme with the nearest names', () => {
        const blueprint = copy(STORE_APP);
        blueprint.uses = { ...blueprint.uses, themes: ['stor'] };

        const { document, errors } = assembleApp(blueprint, STORE_PARTS);

        expect(codesAndPaths(errors)).toEqual(['SUI-USES-MISSING $.uses.themes.0']);
        expect(errors[0]?.message).toContain('theme "stor"');
        expect(errors[0]?.message).toContain('nearest names: store');
        expect(document.theme).toBeUndefined();
    });

    it('should report a missing dataset and leave its binding out of data', () => {
        const blueprint = copy(STORE_APP);
        blueprint.uses = { ...blueprint.uses, data: { ...blueprint.uses?.data, products: { dataset: 'catalogue' } } };

        const { document, errors } = assembleApp(blueprint, STORE_PARTS);

        expect(codesAndPaths(errors)).toEqual(['SUI-USES-MISSING $.uses.data.products.dataset']);
        expect(errors[0]?.message).toContain('nearest names: catalog');
        expect(Object.keys(document.data ?? {})).toEqual(['bag', 'totals']);
    });

    it('should report a component in no owner part and not in the library, once, at its first use', () => {
        const blueprint = copy(STORE_APP);
        (blueprint.screens['home']?.root.children as JsonObject)['a'] = { component: 'product-crad' };
        (blueprint.screens['product']?.root.children as JsonObject)['b'] = { component: 'product-crad' };

        const { errors } = assembleApp(blueprint, STORE_PARTS, { library: STORE_LIBRARY });

        expect(codesAndPaths(errors)).toEqual(['SUI-USES-MISSING $.screens.home.root.children.a']);
        expect(errors[0]?.message).toContain('nearest names: product-card');
    });

    it('should not check component names without a library', () => {
        const blueprint = copy(STORE_APP);
        (blueprint.screens['home']?.root.children as JsonObject)['a'] = { component: 'nowhere' };

        expect(assembleApp(blueprint, STORE_PARTS).errors).toEqual([]);
    });

    it('should report a missing module and a missing persona model', () => {
        const blueprint = copy(STORE_APP);
        blueprint.uses = { ...blueprint.uses, data: { ...blueprint.uses?.data, draft: { model: 'draft-line', scope: 'persona' } }, logic: { coupons: {} } };

        const { errors } = assembleApp(blueprint, STORE_PARTS);

        expect(codesAndPaths(errors)).toEqual(['SUI-USES-MISSING $.uses.data.draft.model', 'SUI-USES-MISSING $.uses.logic.coupons']);
        expect(errors[1]?.message).toContain('nearest names: (none)');
    });

    it('should let an owner component win over a library component of the same name', () => {
        const blueprint = copy(STORE_APP);
        (blueprint.screens['home']?.root.children as JsonObject)['top'] = { component: 'banner' };
        const parts: PartSource = { ...STORE_PARTS, components: { ...STORE_PARTS.components, banner: { tree: { component: 'text', _value: 'Owner banner' }, exposes: [] } } };

        const { document, errors } = assembleApp(blueprint, parts, { library: STORE_LIBRARY });

        expect(errors).toEqual([]);
        expect(document.composed?.['banner']).toEqual({ component: 'text', _value: 'Owner banner' });
    });

    it('should show a changed theme token in every app that lists the theme', () => {
        const other: AppBlueprint = { start: 'only', shell: { component: 'page' }, screens: { only: { root: { component: 'panel' } } }, uses: { themes: ['store'] } };
        const parts = copy(STORE_PARTS);
        ((parts.themes?.['store']?.tokens as JsonObject)['color'] as JsonObject)['brand'] = '#ff0000';

        const documents = [assembleApp(STORE_APP, parts).document, assembleApp(other, parts).document];

        expect(documents.map((document) => document.theme?.tokens)).toEqual([{ color: { brand: '#ff0000' } }, { color: { brand: '#ff0000' } }]);
    });

    it('should share nothing with its inputs', () => {
        const { document } = assembleApp(STORE_APP, STORE_PARTS);

        (document.app.children as JsonObject)['extra'] = { component: 'panel' };
        (document.data?.['products'] as JsonObject)['p3'] = { name: 'Desk' };

        expect(STORE_APP.shell.children).not.toHaveProperty('extra');
        expect(STORE_PARTS.datasets?.['catalog']?.records).not.toHaveProperty('p3');
    });
});

describe('validateApp', () => {
    it('should pass the store app', () => {
        const result = validateApp(STORE_APP, STORE_PARTS, STORE_LIBRARY, { name: 'store' });

        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    it('should refuse a shared dataset binding of a Persisted app and allow persona bindings', () => {
        // Act
        const persisted = validateApp(STORE_APP, STORE_PARTS, STORE_LIBRARY, { name: 'store', mode: 'persisted' });

        // Assert
        expect(persisted.valid).toBe(false);
        expect(persisted.errors.filter((error) => error.code === 'SUI-SYNC-SHARED')).toEqual([
            expect.objectContaining({ statePath: '$.uses.data.products', part: { kind: 'apps', name: 'store' }, message: expect.stringContaining('"catalog"') })
        ]);
        expect(persisted.errors.filter((error) => error.code !== 'SUI-SYNC-SHARED')).toEqual([]);
    });

    it('should allow a shared dataset binding in Full, Standalone and no mode', () => {
        // Act
        const results = (['full', 'standalone', undefined] as const).map((mode) =>
            validateApp(STORE_APP, STORE_PARTS, STORE_LIBRARY, { name: 'store', ...(mode !== undefined && { mode }) })
        );

        // Assert
        expect(results.map((result) => result.errors.map((error) => error.code))).toEqual([[], [], []]);
    });

    it('should give the same result as the single document for a blueprint with only the start screen and no uses', () => {
        const shell = { component: 'page', children: { main: { component: 'outlet' }, note: { component: 'text', wrong: 1 } } };
        const blueprint: AppBlueprint = { start: 'home', shell, screens: { home: { root: { component: 'panel' } } }, locales: { de: {} } };

        const app = validateApp(blueprint, {}, STORE_LIBRARY);
        const single = validateDocument({ app: shell, screens: { home: { root: { component: 'panel' } } }, start: 'home', locales: { de: {} } }, STORE_LIBRARY);

        expect(single.errors.length).toBeGreaterThan(0);
        expect(app.errors.map(({ part: _part, ...error }) => error)).toEqual(single.errors);
        expect(app.valid).toBe(single.valid);
    });

    it('should report an error inside a screen at the screen path and name the app as its part', () => {
        const blueprint = copy(STORE_APP);
        (blueprint.screens['home']?.root.children as JsonObject)['bad'] = { component: 'text', wrong: 1 };

        const result = validateApp(blueprint, STORE_PARTS, STORE_LIBRARY, { name: 'store' });

        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.every((error) => error.statePath?.startsWith('$.screens.home.children.bad'))).toBe(true);
        expect(result.errors.every((error) => !error.message.includes('$.app'))).toBe(true);
        expect(result.errors[0]?.part).toEqual({ kind: 'apps', name: 'store' });
    });

    it('should name the owner component that holds an error, and the app for its instance', () => {
        const parts = copy(STORE_PARTS);
        (parts.components?.['product-card']?.tree.children as JsonObject)['name'] = { component: 'text', wrong: 1 };

        const result = validateApp(STORE_APP, parts, STORE_LIBRARY);

        // As for a single document, the error is reported in the component and again where an instance expands it
        const inComponent = result.errors.filter((error) => error.statePath?.startsWith('$.composed.product-card.'));
        const atInstance = result.errors.filter((error) => error.statePath?.startsWith('$.screens.product.children.card.'));

        expect(inComponent.length).toBeGreaterThan(0);
        expect(inComponent.every((error) => error.part.kind === 'components' && error.part.name === 'product-card')).toBe(true);
        expect(atInstance.every((error) => error.part.kind === 'apps')).toBe(true);
    });

    it('should name the logic module as the part of its binding and param errors', () => {
        const blueprint = copy(STORE_APP);
        blueprint.uses = { ...blueprint.uses, data: { products: { dataset: 'catalog' }, bag: { model: 'product', scope: 'persona' } }, logic: { cart: { params: { taxRate: -1 } } } };

        const result = validateApp(blueprint, STORE_PARTS, STORE_LIBRARY, { name: 'store' });

        expect(codesAndPaths(result.errors)).toEqual(['SUI-USES-MODEL $.uses.data.bag', 'SUI-USES-NEEDS $.uses.data.totals', 'SUI-MODULE-PARAM $.uses.logic.cart.params.taxRate']);
        expect(result.errors.map((error) => error.part)).toEqual([
            { kind: 'logic', name: 'cart' },
            { kind: 'logic', name: 'cart' },
            { kind: 'logic', name: 'cart' }
        ]);
        expect(result.valid).toBe(false);
    });

    it('should report a missing component once, as SUI-USES-MISSING, not again for each node', () => {
        const blueprint = copy(STORE_APP);
        (blueprint.shell.children as JsonObject)['footer'] = { component: 'nowhere' };
        (blueprint.screens['home']?.root.children as JsonObject)['a'] = { component: 'nowhere' };

        const result = validateApp(blueprint, STORE_PARTS, STORE_LIBRARY);

        expect(codesAndPaths(result.errors)).toEqual(['SUI-USES-MISSING $.shell.children.footer']);
        expect(result.valid).toBe(false);
    });
});

describe('nearestNames', () => {
    it('should list up to three close names, nearest first, and none when nothing is close', () => {
        expect(nearestNames('stor', ['store', 'storm', 'plain', 'stork', 'stored'])).toEqual(['store', 'stork', 'storm']);
        expect(nearestNames('catalog', ['orders', 'plain'])).toEqual([]);
        expect(nearestNames('bag', ['shopping-bag'])).toEqual(['shopping-bag']);
    });
});
