import { describe, expect, it } from 'vitest';
import type { AppDocument, JsonObject } from '../types.js';
import { diffInstance, layInstance } from './instance.js';
import type { AppInstance, InstanceBase } from './instance.js';

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

/** A shop: a shell with a search field, a home and a product screen, a night mode overlay and a bag */
const DOCUMENT = deepFreeze({
    app: { component: 'panel' },
    screens: {
        home: { root: { component: 'panel' } },
        product: { params: { id: { type: 'string', required: true } }, root: { component: 'panel' } }
    },
    start: 'home',
    themes: { night: { kind: 'mode', tokens: {} } }
}) as unknown as AppDocument;

/** The definition's resolved starting values */
const BASE: InstanceBase = deepFreeze({
    app: {
        component: 'panel',
        on: { press: { command: 'set', target: '$.data.x', value: 1 } },
        children: { search: { component: 'field', value: '', _label: 'Search' }, header: { component: 'label', text: 'Shop' } }
    },
    screens: {
        home: { component: 'panel', children: { filter: { component: 'field', value: '' } } },
        product: { component: 'panel', children: { qty: { component: 'field', value: '1' } } }
    },
    data: { bag: {}, totals: { net: 0 } }
}) as unknown as InstanceBase;

const EMPTY: AppInstance = deepFreeze({ app: {}, screens: {} });

describe('layInstance', () => {
    it('should lay typed values, the route and the data over the definition and change neither input', () => {
        // Arrange
        const instance: AppInstance = deepFreeze({
            app: { children: { search: { value: 'lamp' } } },
            screens: { product: { children: { qty: { value: '3' } } } },
            route: { screen: 'product', params: { id: 'p2' } },
            data: { bag: { l1: { product: 'p2', qty: 3 } } }
        });

        // Act
        const laid = layInstance(BASE, instance, DOCUMENT);

        // Assert
        expect(laid.warnings).toEqual([]);
        expect((laid.app['children'] as JsonObject)['search']).toEqual({ component: 'field', value: 'lamp', _label: 'Search' });
        expect((laid.app['children'] as JsonObject)['header']).toEqual({ component: 'label', text: 'Shop' });
        expect(laid.screens?.['product']).toEqual({ component: 'panel', children: { qty: { component: 'field', value: '3' } } });
        expect(laid.screens?.['home']).toEqual(BASE.screens?.['home']);
        expect(laid.route).toEqual({ screen: 'product', params: { id: 'p2' } });
        expect(laid.data).toEqual({ bag: { l1: { product: 'p2', qty: 3 } }, totals: { net: 0 } });
    });

    it('should give the definition values and the start route for an empty instance', () => {
        // Act
        const laid = layInstance(BASE, EMPTY, DOCUMENT);

        // Assert
        expect(laid.app).toEqual(BASE.app);
        expect(laid.screens).toEqual(BASE.screens);
        expect(laid.data).toEqual(BASE.data);
        expect(laid.route).toEqual({ screen: 'home', params: {} });
        expect(laid.active).toEqual({});
    });

    it('should never lay content, links, node structure or values of nodes the app no longer has', () => {
        // Arrange
        const instance: AppInstance = {
            app: {
                component: 'list',
                on: {},
                children: { search: { _label: 'Find', '<-value': '$.data.q', component: 'text' }, gone: { value: 'x' } },
                extra: 1
            },
            screens: { removed: { children: {} } }
        };

        // Act
        const laid = layInstance(BASE, instance, DOCUMENT);

        // Assert
        expect(laid.app).toEqual(BASE.app);
        expect(Object.keys(laid.screens ?? {})).toEqual(['home', 'product']);
        expect(laid.warnings).toEqual([]);
    });

    it('should fall back to the start screen with a warning when the instance names a screen the app no longer has', () => {
        // Arrange
        const instance: AppInstance = { ...EMPTY, route: { screen: 'cart', params: {} } };

        // Act
        const laid = layInstance(BASE, instance, DOCUMENT);

        // Assert
        expect(laid.route).toEqual({ screen: 'home', params: {} });
        expect(laid.warnings).toEqual([
            {
                code: 'SUI-INSTANCE-STALE',
                severity: 'warning',
                statePath: '$.route',
                message: 'The instance holds the screen "cart" at $.route, which the app no longer has; the app opens its start screen "home"'
            }
        ]);
    });

    it('should fall back to the start screen when the params of the instance route no longer fit', () => {
        // Act
        const laid = layInstance(BASE, { ...EMPTY, route: { screen: 'product', params: { id: 7 } } }, DOCUMENT);

        // Assert
        expect(laid.route).toEqual({ screen: 'home', params: {} });
        expect(laid.warnings.map((warning) => warning.message)).toEqual([
            'The instance holds params for the screen "product" at $.route, which the app no longer has; the app opens its start screen "home"'
        ]);
    });

    it('should keep the active names the app has and drop a stale overlay name or kind with a warning', () => {
        // Arrange
        const instance: AppInstance = { ...EMPTY, theme: { active: { mode: 'night', motion: 'system', brand: 'acme', shape: 'round' } } };

        // Act
        const laid = layInstance(BASE, instance, DOCUMENT);

        // Assert
        expect(laid.active).toEqual({ mode: 'night', motion: 'system' });
        expect(laid.warnings.map((warning) => `${warning.code} ${warning.severity} ${warning.statePath}`)).toEqual([
            'SUI-INSTANCE-STALE warning $.theme.active.brand',
            'SUI-INSTANCE-STALE warning $.theme.active.shape'
        ]);
        expect(laid.warnings[0]?.message).toBe('The instance holds the brand overlay "acme" at $.theme.active.brand, which the app no longer has; the app keeps its own choice');
        expect(laid.warnings[1]?.message).toContain('the overlay kind "shape"');
    });
});

describe('layInstance with the app themes', () => {
    /** Two themes; only `sand` has the mode overlay `night` */
    const THEMED = deepFreeze({
        ...DOCUMENT,
        themes: undefined,
        appThemes: { sea: { tokens: {} }, sand: { tokens: {}, overlays: { night: { kind: 'mode', tokens: {} } } } }
    }) as unknown as AppDocument;

    it('should keep the instance theme and look its overlay names up in that theme', () => {
        // Act
        const laid = layInstance(BASE, { ...EMPTY, theme: { active: { theme: 'sand', mode: 'night' } } }, THEMED);

        // Assert
        expect(laid.warnings).toEqual([]);
        expect(laid.active).toEqual({ theme: 'sand', mode: 'night' });
    });

    it('should drop a theme the app no longer lists with a warning, and the overlay names its first theme lacks', () => {
        // Act
        const laid = layInstance(BASE, { ...EMPTY, theme: { active: { theme: 'forest', mode: 'night' } } }, THEMED);

        // Assert
        expect(laid.active).toEqual({});
        expect(laid.warnings.map((warning) => warning.message)).toEqual([
            'The instance holds the theme "forest" at $.theme.active.theme, which the app no longer has; the app opens its theme "sea"',
            'The instance holds the mode overlay "night" at $.theme.active.mode, which the app no longer has; the app keeps its own choice'
        ]);
    });
});

describe('diffInstance', () => {
    it('should give the active theme after a switch', () => {
        // Arrange
        const definition = deepFreeze({ theme: { active: { theme: 'sea', mode: 'light' } } }) as unknown as JsonObject;

        // Act
        const diff = diffInstance(definition, { theme: { active: { theme: 'sand', mode: 'light' } } } as unknown as JsonObject);

        // Assert
        expect(diff).toEqual({ theme: { active: { theme: 'sand' } } });
    });

    it('should return exactly the path and value of the one typed value that differs', () => {
        // Arrange
        const current = JSON.parse(JSON.stringify(BASE)) as JsonObject;
        (((current['app'] as JsonObject)['children'] as JsonObject)['search'] as JsonObject)['value'] = 'lamp';

        // Act
        const diff = diffInstance(BASE as unknown as JsonObject, current);

        // Assert
        expect(diff).toEqual({ app: { children: { search: { value: 'lamp' } } } });
    });

    it('should return an empty object for two equal states', () => {
        // Act
        const diff = diffInstance(BASE as unknown as JsonObject, JSON.parse(JSON.stringify(BASE)) as JsonObject);

        // Assert
        expect(diff).toEqual({});
    });

    it('should take new keys and whole arrays from the current state and mark a removed key null', () => {
        // Arrange
        const definition = deepFreeze({ data: { bag: { l1: { qty: 1 } }, tags: ['a'] }, theme: { active: { mode: 'light' } } }) as unknown as JsonObject;
        const current = { data: { bag: { l2: { qty: 2 } }, tags: ['a', 'b'] }, theme: { active: { mode: 'night' } } } as unknown as JsonObject;

        // Act
        const diff = diffInstance(definition, current);

        // Assert
        expect(diff).toEqual({ data: { bag: { l2: { qty: 2 }, l1: null }, tags: ['a', 'b'] }, theme: { active: { mode: 'night' } } });
    });
});
