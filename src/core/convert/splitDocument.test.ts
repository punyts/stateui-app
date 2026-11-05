import { describe, expect, it } from 'vitest';
import { validateApp } from '../assemble/index.js';
import type { PartSource } from '../assemble/index.js';
import '../theme/index.js';
import type { AppDocument, JsonObject } from '../types.js';
import { deepFreeze } from './fixtures/freeze.js';
import { CONVERT_LIBRARY } from './fixtures/library.js';
import { SAMPLE_FORM_AND_LIST_APP } from './fixtures/sampleFormAndListApp.js';
import { STRIP_LOGIC_APP, TABS_APP } from './fixtures/tabsApp.js';
import { splitDocument } from './splitDocument.js';
import type { SplitResult } from './types.js';

function partsOf(result: SplitResult): PartSource {
    return { themes: result.themes, models: result.models, datasets: result.datasets, components: result.components };
}

/** The errors of validating a converted app, without warnings */
function errorsOf(result: SplitResult): string[] {
    if (result.app === undefined) throw new Error('no app');
    const validation = validateApp(result.app.blueprint, partsOf(result), CONVERT_LIBRARY, { name: result.app.name });
    return validation.errors.filter((error) => error.severity !== 'warning').map((error) => `${error.code} ${error.message}`);
}

/** A tiny one-screen document with the given data */
function withData(data: JsonObject): AppDocument {
    return deepFreeze({ app: { component: 'text', _text: 'Hi' }, data }) as unknown as AppDocument;
}

describe('splitDocument with one screen', () => {
    it('should make an outlet shell and the whole tree the screen main, and pass validateApp', () => {
        // Act
        const result = splitDocument({ name: 'Customers', document: SAMPLE_FORM_AND_LIST_APP });

        // Assert
        expect(result.report).toEqual([]);
        expect(result.app?.name).toBe('customers');
        const blueprint = result.app?.blueprint;
        expect(blueprint?.title).toBe('Customers');
        expect(blueprint?.shell).toEqual({ component: 'outlet' });
        expect(blueprint?.start).toBe('main');
        expect(blueprint?.screens['main']?.root).toEqual(SAMPLE_FORM_AND_LIST_APP.app);
        expect(blueprint?.uses).toEqual({ data: { customers: { dataset: 'customers-customers' } } });
        expect(errorsOf(result)).toEqual([]);
    });

    it('should key a list of records by their id and infer the model of the same name', () => {
        // Act
        const result = splitDocument({ name: 'Customers', document: SAMPLE_FORM_AND_LIST_APP });

        // Assert
        expect(result.datasets).toEqual({
            'customers-customers': {
                model: 'customers-customers',
                records: { c1: { id: 'c1', name: 'Ada Lovelace' }, c2: { id: 'c2', name: 'Grace Hopper' } }
            }
        });
        expect(result.models).toEqual({ 'customers-customers': { fields: { id: { type: 'string' }, name: { type: 'string' } } } });
    });

    it('should take the data of the snapshot and drop its articulation', () => {
        // Arrange
        const snapshot = deepFreeze({ data: { customers: [{ id: 'c3', name: 'Mary Somerville' }] }, app: { children: { main: { _title: 'Typed' } } } });

        // Act
        const result = splitDocument({ name: 'Customers', document: SAMPLE_FORM_AND_LIST_APP, snapshot });

        // Assert
        expect(result.datasets['customers-customers']?.records).toEqual({ c3: { id: 'c3', name: 'Mary Somerville' } });
        expect(result.app?.blueprint.screens['main']?.root).toEqual(SAMPLE_FORM_AND_LIST_APP.app);
    });

    it('should key records without an id or with an integer-like id by slugs', () => {
        // Act
        const result = splitDocument({ name: 'notes', document: withData({ notes: [{ text: 'a' }, { id: 7, text: 'b' }, { id: 'x', text: 'c' }, { id: 'x', text: 'd' }] }) });

        // Assert
        expect(Object.keys(result.datasets['notes-notes']?.records ?? {})).toEqual(['r1', 'n7', 'x', 'x-2']);
    });

    it('should move app-event entries of the root to the shell and follow paths into the tree', () => {
        // Arrange
        const document = deepFreeze({
            app: {
                component: 'panel',
                on: { 'sync.rejected': { command: 'set', target: '$.app.children.note._text', value: 'Not saved' } },
                children: { note: { component: 'text', _text: '' } }
            }
        }) as unknown as AppDocument;

        // Act
        const result = splitDocument({ name: 'notes', document });

        // Assert
        expect(result.app?.blueprint.shell).toEqual({
            component: 'outlet',
            on: { 'sync.rejected': { command: 'set', target: '$.screens.main.children.note._text', value: 'Not saved' } }
        });
        expect(result.app?.blueprint.screens['main']?.root).toEqual({ component: 'panel', children: { note: { component: 'text', _text: '' } } });
    });
});

describe('splitDocument with a hidden-strip tabs', () => {
    const result = splitDocument({ name: 'Halo Store', document: TABS_APP });
    const blueprint = result.app?.blueprint;

    it('should put an outlet in the strip place and make each tab a screen titled by its tab', () => {
        // Assert
        expect(result.report).toEqual([]);
        expect(blueprint?.shell).toEqual({
            component: 'page',
            _title: 'Halo',
            children: { header: { component: 'text', _text: 'Welcome to Halo' }, pages: { component: 'outlet' } }
        });
        expect(Object.keys(blueprint?.screens ?? {})).toEqual(['home', 'bag']);
        expect(blueprint?.screens['home']?.title).toBe('Home');
        expect(blueprint?.screens['bag']?.title).toBe('Your bag');
        expect(blueprint?.screens['bag']?.root).not.toHaveProperty('placement');
        expect(blueprint?.start).toBe('home');
    });

    it('should turn a set of the strip into a navigate and follow paths into the tabs in logic', () => {
        // Act
        const open = ((blueprint?.screens['home']?.root['children'] as JsonObject)['open'] as JsonObject)['on'];
        const rule = (blueprint?.logic?.rules as JsonObject | undefined)?.['counted'] as JsonObject;

        // Assert
        expect(open).toEqual({ press: { command: 'navigate', target: 'bag' } });
        expect((rule['do'] as JsonObject[])[0]?.['target']).toBe('$.screens.bag.children.count._text');
    });

    it('should make the theme a part named after the app without the active choice', () => {
        // Assert
        expect(blueprint?.uses?.themes).toEqual(['halo-store']);
        expect(result.themes).toEqual({
            'halo-store': {
                tokens: { color: { accent: { base: '#0050a0' } } },
                overlays: { night: { kind: 'mode', tokens: { color: { surface: { base: '#101820' } } } } }
            }
        });
    });

    it('should make composed components owner components and rename the nodes that use them', () => {
        // Assert
        expect(Object.keys(result.components)).toEqual(['product-card']);
        expect(result.components['product-card']?.exposes).toEqual([{ path: 'children.name._text', description: 'The product name' }]);
        expect(((blueprint?.screens['home']?.root['children'] as JsonObject)['featured'] as JsonObject)['component']).toBe('product-card');
    });

    it('should split the locale overlay between the shell and the screens', () => {
        // Assert
        expect(blueprint?.locales).toEqual({ de: { children: { header: { _text: 'Willkommen bei Halo' } } } });
        expect(blueprint?.screens['home']?.locales).toEqual({ de: { children: { intro: { _text: 'Lampen und Stühle' } } } });
        expect(blueprint?.screens['bag']?.locales).toBeUndefined();
    });

    it('should bind each data key back under its name and pass validateApp', () => {
        // Assert
        expect(blueprint?.uses?.data).toEqual({ products: { dataset: 'halo-store-products' }, bag: { dataset: 'halo-store-bag' } });
        expect(result.models['halo-store-products']).toEqual({ fields: { id: { type: 'string' }, name: { type: 'string' }, price: { type: 'number' } } });
        expect(errorsOf(result)).toEqual([]);
    });

    it('should list every renamed name', () => {
        // Assert
        expect(result.renamed.filter((rename) => rename.kind !== 'data' && rename.kind !== 'models')).toEqual([
            { kind: 'apps', from: 'Halo Store', to: 'halo-store' },
            { kind: 'components', from: 'Product Card', to: 'product-card' },
            { kind: 'screens', from: 'Bag', to: 'bag' }
        ]);
    });
});

describe('splitDocument reports', () => {
    it('should report a strip that logic switches and return no parts', () => {
        // Act
        const result = splitDocument({ name: 'Halo Store', document: STRIP_LOGIC_APP });

        // Assert
        expect(result.app).toBeUndefined();
        expect([result.themes, result.models, result.datasets, result.components]).toEqual([{}, {}, {}, {}]);
        expect(result.report).toEqual([
            {
                path: '$.logic.rules.toBag.do.0.target',
                reason: 'refers to the hidden-strip tabs at $.app.children.pages ($.app.children.pages.active), which screens cannot follow'
            }
        ]);
    });

    it('should report a second hidden strip and a strip linked to data', () => {
        // Arrange
        const document = deepFreeze({
            app: {
                component: 'panel',
                children: {
                    pages: { component: 'tabs', strip: 'hidden', '<-active': '$.data.page', children: { a: { component: 'text' } } },
                    more: { component: 'tabs', strip: 'hidden', children: { b: { component: 'text' } } }
                }
            },
            data: { page: 'a', tags: ['x'] }
        }) as unknown as AppDocument;

        // Act
        const result = splitDocument({ name: 'pages', document });

        // Assert
        expect(result.app).toBeUndefined();
        expect(result.report.map((entry) => entry.path)).toEqual(['$.app.children.more', '$.app.children.pages.<-active']);
    });

    it('should report data that holds no records', () => {
        // Act
        const result = splitDocument({ name: 'notes', document: withData({ count: 3, tags: ['x'], form: { name: '' } }) });

        // Assert
        expect(result.report).toEqual([
            { path: '$.data.count', reason: 'holds a number, not records, so it cannot become a dataset' },
            { path: '$.data.tags', reason: 'holds a list whose items are not all records, so it cannot become a dataset' },
            { path: '$.data.form', reason: 'holds an object whose values are not all records, so it cannot become a dataset' }
        ]);
    });

    it('should report a document that already has screens', () => {
        // Act
        const result = splitDocument({ name: 'new', document: deepFreeze({ app: { component: 'outlet' }, screens: {}, start: 'a' }) as unknown as AppDocument });

        // Assert
        expect(result.report).toEqual([{ path: '$.screens', reason: 'the document already has screens' }]);
    });
});

describe('splitDocument names', () => {
    it('should give a clashing name a numeric suffix', () => {
        // Act
        const result = splitDocument({ name: 'customers', document: SAMPLE_FORM_AND_LIST_APP, taken: { apps: ['customers'], data: ['customers-customers'] } });

        // Assert
        expect(result.app?.name).toBe('customers-2');
        expect(Object.keys(result.datasets)).toEqual(['customers-2-customers']);
    });

    it('should prefix a leading digit with a letter', () => {
        // Act
        const result = splitDocument({ name: '2024 Report', document: withData({}) });

        // Assert
        expect(result.app?.name).toBe('n2024-report');
    });

    it('should lower-case and hyphenate an uppercase name with spaces and keep it as the title', () => {
        // Act
        const result = splitDocument({ name: 'My Shop', document: withData({}) });

        // Assert
        expect(result.app?.name).toBe('my-shop');
        expect(result.app?.blueprint.title).toBe('My Shop');
        expect(result.renamed).toEqual([{ kind: 'apps', from: 'My Shop', to: 'my-shop' }]);
    });
});
