import { describe, expect, it } from 'vitest';
import type { AppBlueprint } from '../blueprint/types.js';
import type { BuildError } from '../errors/index.js';
import type { JsonObject } from '../types.js';
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
        expect(document.data).toEqual({ products: { p1: { name: 'Lamp', price: 30 }, p2: { name: 'Chair', price: 90 } } });
        expect(document.logic).toEqual(STORE_APP.logic);
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
            { kind: 'components', name: 'brand-mark' },
            { kind: 'components', name: 'product-card' }
        ]);
    });

    it('should start a persona binding as an empty map and list its model', () => {
        const blueprint = copy(STORE_APP);
        blueprint.uses = { ...blueprint.uses, data: { ...blueprint.uses?.data, bag: { model: 'product', scope: 'persona' } } };

        const { document, uses, errors } = assembleApp(blueprint, STORE_PARTS);

        expect(errors).toEqual([]);
        expect(document.data?.['bag']).toEqual({});
        expect(uses).toContainEqual({ kind: 'models', name: 'product' });
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
        blueprint.uses = { ...blueprint.uses, data: { products: { dataset: 'catalogue' } } };

        const { document, errors } = assembleApp(blueprint, STORE_PARTS);

        expect(codesAndPaths(errors)).toEqual(['SUI-USES-MISSING $.uses.data.products.dataset']);
        expect(errors[0]?.message).toContain('nearest names: catalog');
        expect(document.data).toBeUndefined();
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
        blueprint.uses = { ...blueprint.uses, data: { ...blueprint.uses?.data, bag: { model: 'bag-line', scope: 'persona' } }, logic: { cart: {} } };

        const { errors } = assembleApp(blueprint, STORE_PARTS);

        expect(codesAndPaths(errors)).toEqual(['SUI-USES-MISSING $.uses.data.bag.model', 'SUI-USES-MISSING $.uses.logic.cart']);
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
