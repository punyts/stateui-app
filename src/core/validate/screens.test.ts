import { describe, expect, it } from 'vitest';
import { STORE_LIBRARY } from '../assemble/fixtures/storeApp.js';
import type { BuildError } from '../errors/index.js';
import { checkLimits, MAX_NODES } from '../limits.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { initialRoute, paramDefaults, ROUTE_PATH } from '../route/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { AppDocument, JsonObject, JsonValue } from '../types.js';
import { validateDocument } from './index.js';

function shapeOf(properties: Record<string, unknown>, events: string[]): Shape {
    const result = parseShape({ summary: 'Test', properties, events, commands: [] }, 'test.state.json');
    if (result.shape === undefined) throw new Error('fixture shape');
    return result.shape;
}

const LIBRARY: ComponentLibrary = Object.freeze({
    ...STORE_LIBRARY,
    button: { tier: 'root', tag: 'ui-button', shape: shapeOf({ pressed: { type: 'boolean', default: false } }, ['press']) }
});

/** An app node and two screens; `product` takes an `id` param with a default */
const DOCUMENT = Object.freeze({
    app: { component: 'app', layout: { type: 'column' } },
    screens: {
        home: { title: 'Home', root: { component: 'panel', children: { go: { component: 'button' } } } },
        product: { title: 'Product', params: { id: { type: 'string', default: 'p1' }, tab: { type: 'string' } }, root: { component: 'panel' } }
    },
    start: 'home'
}) as unknown as JsonObject;

/** The document with `value` written at the dotted `path` (`undefined` removes the key) */
function documentWith(path: string, value: JsonValue | undefined): JsonObject {
    const copy = JSON.parse(JSON.stringify(DOCUMENT)) as JsonObject;
    const keys = path.split('.');
    const last = keys.pop() as string;
    let parent = copy as Record<string, JsonValue>;
    for (const key of keys) parent = parent[key] as Record<string, JsonValue>;
    if (value === undefined) delete parent[last];
    else parent[last] = value;
    return copy;
}

function codesAndPaths(errors: readonly BuildError[]): string[] {
    return errors.map((error) => `${error.code} ${error.statePath ?? ''}`);
}

describe('validateDocument with screens', () => {
    it('should accept a document with an app node, screens and start', () => {
        expect(validateDocument(DOCUMENT, LIBRARY).errors).toEqual([]);
    });

    it('should reject a document that holds a route key', () => {
        const errors = validateDocument(documentWith('route', { screen: 'home', params: {} }), LIBRARY).errors;

        expect(codesAndPaths(errors)).toEqual(['SUI-DOC-KEY $.route']);
    });

    it('should check every screen root like the app tree, at the screen path', () => {
        const document = documentWith('screens.product.root.children', { name: { component: 'text', wrong: 1 }, x: { component: 'nowhere' } });

        const errors = validateDocument(document, LIBRARY).errors;

        expect(codesAndPaths(errors).sort()).toEqual(['SUI-NODE-UNKNOWN $.screens.product.children.x', 'SUI-STATE-UNKNOWN $.screens.product.children.name.wrong']);
    });

    it('should check on entries of screen nodes', () => {
        const document = documentWith('screens.home.root.children.go.on', { tap: { command: 'set', target: '.pressed', value: true } });

        const errors = validateDocument(document, LIBRARY).errors;

        expect(errors.length).toBeGreaterThan(0);
        expect(errors.every((error) => error.statePath?.startsWith('$.screens.home.children.go'))).toBe(true);
    });

    it('should check layouts and integer-like keys in screens', () => {
        const layout = documentWith('screens.home.root.layout', { type: 'nowhere' });
        const ordered = documentWith('screens.home.root.children', { '7': { component: 'text' } });

        expect(codesAndPaths(validateDocument(layout, LIBRARY).errors)[0]).toMatch(/^SUI-LAYOUT-\S+ \$\.screens\.home/);
        expect(codesAndPaths(validateDocument(ordered, LIBRARY).errors)).toContain('SUI-DOC-ORDER $.screens.home.children.7');
    });

    it('should report screen entries that are not { title?, params?, root }', () => {
        expect(codesAndPaths(validateDocument(documentWith('screens.home.root', undefined), LIBRARY).errors)).toEqual(['SUI-DOC-SCREEN $.screens.home']);
        expect(codesAndPaths(validateDocument(documentWith('screens.home.extra', 1), LIBRARY).errors)).toEqual(['SUI-DOC-SCREEN $.screens.home']);
        expect(codesAndPaths(validateDocument(documentWith('screens.home.title', 3), LIBRARY).errors)).toEqual(['SUI-DOC-SCREEN $.screens.home']);
        expect(codesAndPaths(validateDocument(documentWith('screens.product.params.id', { type: 'date' }), LIBRARY).errors)).toEqual(['SUI-DOC-SCREEN $.screens.product']);
        expect(codesAndPaths(validateDocument(documentWith('screens.Cart', { root: { component: 'panel' } }), LIBRARY).errors)).toEqual(['SUI-DOC-SCREEN $.screens.Cart']);
        expect(codesAndPaths(validateDocument(documentWith('screens', []), LIBRARY).errors)).toContain('SUI-DOC-TYPE $.screens');
        expect(codesAndPaths(validateDocument(documentWith('screens.home.locales', { de: 'Start' }), LIBRARY).errors)).toEqual(['SUI-DOC-SCREEN $.screens.home']);
        expect(codesAndPaths(validateDocument(documentWith('screens.home.locales', []), LIBRARY).errors)).toEqual(['SUI-DOC-SCREEN $.screens.home']);
    });

    it('should need an app node with no children at $.app and none elsewhere', () => {
        // Arrange
        const notApp = documentWith('app', { component: 'panel', children: { header: { component: 'text' } } });
        const withChildren = documentWith('app.children', { header: { component: 'text' } });
        const inScreen = documentWith('screens.home.root.children', { go: { component: 'button' }, inner: { component: 'app' } });
        const withoutScreens = { app: { component: 'panel', children: { inner: { component: 'text' } } } } as unknown as JsonObject;

        // Act
        const appErrors = (document: JsonObject): string[] => codesAndPaths(validateDocument(document, LIBRARY).errors.filter((error) => error.code === 'SUI-APP-ROOT'));

        // Assert
        expect(appErrors(notApp)).toEqual(['SUI-APP-ROOT $.app']);
        expect(appErrors(withChildren)).toEqual(['SUI-APP-ROOT $.app.children']);
        expect(appErrors(inScreen)).toEqual(['SUI-APP-ROOT $.screens.home.children.inner']);
        expect(appErrors(withoutScreens)).toEqual([]);
        expect(appErrors(DOCUMENT)).toEqual([]);
    });

    it('should check the placement of a screen root against the app layout', () => {
        // Arrange
        const region = documentWith('app.layout', { type: 'region' });
        (((region['screens'] as JsonObject)['home'] as JsonObject)['root'] as JsonObject)['placement'] = { region: 'center' };
        const column = documentWith('screens.home.root.placement', { region: 'center' });

        // Act and Assert
        expect(codesAndPaths(validateDocument(region, LIBRARY).errors)).toEqual([]);
        expect(codesAndPaths(validateDocument(column, LIBRARY).errors)).toEqual(['SUI-LAYOUT-FIELD $.screens.home.placement.region']);
    });

    it('should need start with screens, naming one of them, and screens with start', () => {
        expect(codesAndPaths(validateDocument(documentWith('start', undefined), LIBRARY).errors)).toEqual(['SUI-DOC-SCREEN $.start']);
        expect(codesAndPaths(validateDocument(documentWith('start', 'cart'), LIBRARY).errors)).toEqual(['SUI-DOC-SCREEN $.start']);
        expect(codesAndPaths(validateDocument(documentWith('screens', undefined), LIBRARY).errors)).toEqual(['SUI-DOC-SCREEN $.start']);
        expect(codesAndPaths(validateDocument(documentWith('start', 3), LIBRARY).errors)).toEqual(['SUI-DOC-TYPE $.start']);
    });

    it('should leave a document without screens as it was', () => {
        const single = { app: { component: 'panel', children: { a: { component: 'text' } } } };

        expect(validateDocument(single, LIBRARY).errors).toEqual([]);
    });

    it('should count screen nodes toward the node limit', () => {
        const children = Object.fromEntries(Array.from({ length: MAX_NODES }, (_, index) => [`n${index}`, { component: 'text' }]));
        const document = documentWith('screens.home.root.children', children) as unknown as AppDocument;

        expect(checkLimits(document).map((error) => error.code)).toEqual(['SUI-DOC-LIMIT-NODES']);
    });
});

describe('initialRoute', () => {
    it('should start on the start screen with the defaults of its params', () => {
        const document = documentWith('start', 'product') as unknown as AppDocument;

        expect(initialRoute(document)).toEqual({ screen: 'product', params: { id: 'p1' } });
        expect(initialRoute(DOCUMENT as unknown as AppDocument)).toEqual({ screen: 'home', params: {} });
    });

    it('should give no route for an app without screens or with a start that names none', () => {
        expect(initialRoute({})).toBeUndefined();
        expect(initialRoute(documentWith('start', 'cart') as unknown as AppDocument)).toBeUndefined();
    });

    it('should copy defaults, so a route never shares a value with the document', () => {
        const declarations = Object.freeze({ tags: Object.freeze({ type: 'array', default: Object.freeze(['a']) }) }) as unknown as JsonObject;

        const params = paramDefaults(declarations);
        (params['tags'] as JsonValue[]).push('b');

        expect(((declarations['tags'] as JsonObject)['default'] as JsonValue[]).length).toBe(1);
        expect(ROUTE_PATH).toBe('$.route');
    });
});
