import { describe, expect, it } from 'vitest';
import type { JsonObject, JsonValue } from '../types.js';
import { FIELD_TYPES, PART_KINDS, isPartName, readBlueprint, slugifyName } from './index.js';

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

/** The blueprint of the design's store example */
const STORE: JsonObject = deepFreeze({
    title: 'Halo',
    uses: {
        themes: ['halo'],
        data: {
            products: { dataset: 'catalog' },
            bag: { model: 'bag-line', scope: 'persona' }
        },
        logic: { cart: { params: { taxRate: 0.0825, currency: 'USD' } } }
    },
    start: 'home',
    shell: { component: 'page', children: { header: { component: 'panel' }, main: { component: 'outlet' } } },
    screens: {
        home: { title: 'Store', root: { component: 'panel' } },
        product: { title: 'Product', params: { id: { type: 'string' } }, root: { component: 'panel' } }
    },
    logic: { machines: {}, rules: {}, tables: {} },
    locales: { de: {} }
});

/** The store blueprint with `value` written at the dotted `path` (`undefined` removes the key) */
function storeWith(path: string, value: JsonValue | undefined): JsonObject {
    const copy = JSON.parse(JSON.stringify(STORE)) as JsonObject;
    const keys = path.split('.');
    const last = keys.pop() as string;
    let parent = copy as Record<string, JsonValue>;
    for (const key of keys) parent = parent[key] as Record<string, JsonValue>;
    if (value === undefined) delete parent[last];
    else parent[last] = value;
    return copy;
}

/** The code and path (from the message) of each error */
function errorsOf(json: JsonValue): string[] {
    return readBlueprint(json).errors.map((error) => `${error.code} ${/at (\S+) is/.exec(error.message)?.[1] ?? ''}`);
}

describe('isPartName', () => {
    it('should accept lower-case slugs that start with a letter, up to 63 characters', () => {
        const names = ['halo', 'bag-line', 'a', 'v2', `a${'b'.repeat(62)}`];

        expect(names.every(isPartName)).toBe(true);
    });

    it('should refuse integer-like, upper-case, too long, empty and non-text names', () => {
        const names: unknown[] = ['42', '2go', 'Halo', 'bag_line', '-a', '', `a${'b'.repeat(63)}`, 7, undefined];

        expect(names.filter(isPartName)).toEqual([]);
    });
});

describe('slugifyName', () => {
    it('should lower-case and turn every other character run into one dash', () => {
        expect(slugifyName('My Store!  App')).toBe('my-store-app');
        expect(slugifyName('  --bag_line--  ')).toBe('bag-line');
    });

    it('should prefix a leading digit with a letter', () => {
        expect(slugifyName('42')).toBe('n42');
        expect(slugifyName('3d viewer')).toBe('n3d-viewer');
    });

    it('should name a slug without letters or digits', () => {
        expect(slugifyName('***')).toBe('part');
    });

    it('should add a numeric suffix while the name is taken', () => {
        expect(slugifyName('Halo', ['halo'])).toBe('halo-2');
        expect(slugifyName('Halo', ['halo', 'halo-2'])).toBe('halo-3');
    });

    it('should keep a long slug and its suffix within 63 characters', () => {
        const long = 'x'.repeat(80);

        const first = slugifyName(long);
        const second = slugifyName(long, [first]);

        expect(first).toHaveLength(63);
        expect(second).toHaveLength(63);
        expect(second.endsWith('-2')).toBe(true);
        expect([first, second].every(isPartName)).toBe(true);
    });
});

describe('readBlueprint', () => {
    it('should return the typed blueprint of the store example with no errors', () => {
        const result = readBlueprint(STORE);

        expect(result.errors).toEqual([]);
        expect(result.blueprint?.start).toBe('home');
        expect(result.blueprint?.uses?.data?.['bag']).toEqual({ model: 'bag-line', scope: 'persona' });
    });

    it('should accept a blueprint with only start, shell and screens', () => {
        const json = { start: 'home', shell: { component: 'page' }, screens: { home: { root: { component: 'panel' } } } };

        expect(readBlueprint(json).errors).toEqual([]);
    });

    it('should refuse a value that is not an object', () => {
        expect(errorsOf([])).toEqual(['SUI-BLUEPRINT-SHAPE $']);
    });

    it('should name each unknown key with its path', () => {
        expect(errorsOf(storeWith('theme', {}))).toEqual(['SUI-BLUEPRINT-SHAPE $.theme']);
        expect(errorsOf(storeWith('uses.models', []))).toEqual(['SUI-BLUEPRINT-SHAPE $.uses.models']);
        expect(errorsOf(storeWith('screens.home.children', {}))).toEqual(['SUI-BLUEPRINT-SHAPE $.screens.home.children']);
        expect(errorsOf(storeWith('logic.other', {}))).toEqual(['SUI-BLUEPRINT-SHAPE $.logic.other']);
    });

    it('should refuse uses of the wrong shape', () => {
        expect(errorsOf(storeWith('uses', []))).toEqual(['SUI-BLUEPRINT-SHAPE $.uses']);
        expect(errorsOf(storeWith('uses.themes', 'halo'))).toEqual(['SUI-BLUEPRINT-SHAPE $.uses.themes']);
        expect(errorsOf(storeWith('uses.themes', ['halo', 'Dark', 'halo']))).toEqual(['SUI-BLUEPRINT-SHAPE $.uses.themes.1', 'SUI-BLUEPRINT-SHAPE $.uses.themes.2']);
        expect(errorsOf(storeWith('uses.data', ['catalog']))).toEqual(['SUI-BLUEPRINT-SHAPE $.uses.data']);
        expect(errorsOf(storeWith('uses.logic.Cart', {}))).toEqual(['SUI-BLUEPRINT-SHAPE $.uses.logic.Cart']);
        expect(errorsOf(storeWith('uses.logic.cart.params', 3))).toEqual(['SUI-BLUEPRINT-SHAPE $.uses.logic.cart.params']);
        expect(errorsOf(storeWith('uses.logic.cart.extra', 1))).toEqual(['SUI-BLUEPRINT-SHAPE $.uses.logic.cart.extra']);
    });

    it('should refuse a data binding that is neither a dataset nor a persona model', () => {
        expect(errorsOf(storeWith('uses.data.products', { name: 'catalog' }))).toEqual(['SUI-BLUEPRINT-SHAPE $.uses.data.products']);
        expect(errorsOf(storeWith('uses.data.products', { dataset: 'Catalog' }))).toEqual(['SUI-BLUEPRINT-SHAPE $.uses.data.products.dataset']);
        expect(errorsOf(storeWith('uses.data.products', { dataset: 'catalog', scope: 'persona' }))).toEqual(['SUI-BLUEPRINT-SHAPE $.uses.data.products.scope']);
        expect(errorsOf(storeWith('uses.data.bag', { model: 'bag-line' }))).toEqual(['SUI-BLUEPRINT-SHAPE $.uses.data.bag.scope']);
        expect(errorsOf(storeWith('uses.data.my-bag', { model: 'bag-line', scope: 'persona' }))).toEqual(['SUI-BLUEPRINT-SHAPE $.uses.data.my-bag']);
    });

    it('should refuse a screen without root and a root or shell that is not a node', () => {
        expect(errorsOf(storeWith('screens.home.root', undefined))).toEqual(['SUI-BLUEPRINT-SHAPE $.screens.home.root']);
        expect(errorsOf(storeWith('screens.home.root', { children: {} }))).toEqual(['SUI-BLUEPRINT-SHAPE $.screens.home.root']);
        expect(errorsOf(storeWith('shell', undefined))).toEqual(['SUI-BLUEPRINT-SHAPE $.shell']);
    });

    it('should accept screen locales and refuse ones that are not overlays by language', () => {
        expect(errorsOf(storeWith('screens.home.locales', { de: { children: {} } }))).toEqual([]);
        expect(errorsOf(storeWith('screens.home.locales', { de: 'Start' }))).toEqual(['SUI-BLUEPRINT-SHAPE $.screens.home.locales.de']);
    });

    it('should refuse missing or empty screens and screen names that are not part names', () => {
        expect(errorsOf(storeWith('screens', {}))).toEqual(['SUI-BLUEPRINT-SHAPE $.screens', 'SUI-BLUEPRINT-SHAPE $.start']);
        expect(errorsOf(storeWith('screens.Cart', { root: { component: 'panel' } }))).toEqual(['SUI-BLUEPRINT-SHAPE $.screens.Cart']);
    });

    it('should refuse a start that names no screen, and a missing start', () => {
        expect(errorsOf(storeWith('start', 'cart'))).toEqual(['SUI-BLUEPRINT-SHAPE $.start']);
        expect(errorsOf(storeWith('start', undefined))).toEqual(['SUI-BLUEPRINT-SHAPE $.start']);
    });

    it('should refuse params that are not typed declarations', () => {
        const at = 'screens.product.params.id';

        expect(errorsOf(storeWith(at, 'string'))).toEqual([`SUI-BLUEPRINT-SHAPE $.${at}`]);
        expect(errorsOf(storeWith(at, {}))).toEqual([`SUI-BLUEPRINT-SHAPE $.${at}.type`]);
        expect(errorsOf(storeWith(at, { type: 'date' }))).toEqual([`SUI-BLUEPRINT-SHAPE $.${at}.type`]);
        expect(errorsOf(storeWith(at, { type: 'string', enum: ['a'] }))).toEqual([`SUI-BLUEPRINT-SHAPE $.${at}.enum`]);
        expect(errorsOf(storeWith(at, { type: 'string', required: 'yes' }))).toEqual([`SUI-BLUEPRINT-SHAPE $.${at}.required`]);
        expect(errorsOf(storeWith(at, { type: 'string', validators: { email: true } }))).toEqual([`SUI-BLUEPRINT-SHAPE $.${at}.validators.email`]);
        expect(errorsOf(storeWith('screens.product.params', ['id']))).toEqual(['SUI-BLUEPRINT-SHAPE $.screens.product.params']);
    });

    it('should refuse a param default that does not fit its type or validators, and validator options that are not valid', () => {
        const at = 'screens.product.params.id';

        expect(errorsOf(storeWith(at, { type: 'integer', default: 'one' }))).toEqual([`SUI-BLUEPRINT-SHAPE $.${at}.default`]);
        expect(errorsOf(storeWith(at, { type: 'string', default: 'x', validators: { oneOf: ['a', 'b'] } }))).toEqual([`SUI-BLUEPRINT-SHAPE $.${at}.default`]);
        expect(errorsOf(storeWith(at, { type: 'string', validators: { length: { min: 'one' } } }))).toEqual([`SUI-BLUEPRINT-SHAPE $.${at}.validators.length`]);
        expect(errorsOf(storeWith(at, { type: 'boolean', validators: { range: { min: 0 } } }))).toEqual([`SUI-BLUEPRINT-SHAPE $.${at}.validators.range`]);
    });

    it('should accept every field type and the library validators in a declaration', () => {
        const params = Object.fromEntries(FIELD_TYPES.map((type) => [`p_${type}`, { type }]));
        const checked = { type: 'string', default: 'a', required: false, validators: { pattern: '^[a-z]$', length: { max: 1 } } };

        expect(readBlueprint(storeWith('screens.product.params', { ...params, checked })).errors).toEqual([]);
    });

    it('should refuse a title, locale or logic section of the wrong type', () => {
        expect(errorsOf(storeWith('title', 3))).toEqual(['SUI-BLUEPRINT-SHAPE $.title']);
        expect(errorsOf(storeWith('locales.de', 'x'))).toEqual(['SUI-BLUEPRINT-SHAPE $.locales.de']);
        expect(errorsOf(storeWith('logic.rules', []))).toEqual(['SUI-BLUEPRINT-SHAPE $.logic.rules']);
    });

    it('should report every error of a blueprint at once and return no blueprint', () => {
        const json = storeWith('start', 'cart');
        (json['screens'] as JsonObject)['home'] = { title: 'Store' };

        const result = readBlueprint(json);

        expect(result.blueprint).toBeUndefined();
        expect(result.errors.map((error) => error.code)).toEqual(['SUI-BLUEPRINT-SHAPE', 'SUI-BLUEPRINT-SHAPE']);
    });
});

describe('PART_KINDS', () => {
    it('should list the owner roots of build-time parts and data', () => {
        expect(PART_KINDS).toEqual(['apps', 'themes', 'logic', 'models', 'data', 'components', 'patterns']);
    });
});
