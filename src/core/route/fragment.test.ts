import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../types.js';
import { formatFragment, parseFragment, sameRoute } from './fragment.js';
import type { RouteScreens } from './route.js';

const SCREENS = Object.freeze({
    home: {},
    product: {
        params: Object.freeze({
            id: { type: 'string', required: true },
            tab: { type: 'string', default: 'details' },
            qty: { type: 'integer' },
            gift: { type: 'boolean' },
            filter: { type: 'object' }
        }) as unknown as JsonObject
    },
    'order-list': {}
}) as RouteScreens;

describe('formatFragment', () => {
    it('should write the screen and only the params that differ from their defaults', () => {
        // Act
        const plain = formatFragment({ screen: 'home', params: {} }, SCREENS);
        const product = formatFragment({ screen: 'product', params: { id: 'p 42', tab: 'details', qty: 3, gift: true, filter: { color: 'red' } } }, SCREENS);

        // Assert
        expect(plain).toBe('#/home');
        expect(product).toBe('#/product?id=p+42&qty=3&gift=true&filter=%7B%22color%22%3A%22red%22%7D');
    });
});

describe('parseFragment', () => {
    it('should read back what formatFragment wrote, with each param in its declared type and the defaults filled in', () => {
        // Arrange
        const route = { screen: 'product', params: { id: 'p 42', tab: 'reviews', qty: 3, gift: false, filter: { color: 'red' } } };

        // Act
        const parsed = parseFragment(formatFragment(route, SCREENS), SCREENS);

        // Assert
        expect(parsed).toEqual(route);
        expect(parseFragment('#/product?id=p1', SCREENS)).toEqual({ screen: 'product', params: { id: 'p1', tab: 'details' } });
        expect(parseFragment('#/order-list', SCREENS)).toEqual({ screen: 'order-list', params: {} });
    });

    it('should return undefined for a fragment that names no screen', () => {
        // Assert
        expect(parseFragment('', SCREENS)).toBeUndefined();
        expect(parseFragment('#section-2', SCREENS)).toBeUndefined();
        expect(parseFragment('#/', SCREENS)).toBeUndefined();
    });

    it('should give the reason for an unknown screen, a missing required param, a wrong type and an undeclared param', () => {
        // Act
        const reasons = ['#/cart', '#/product', '#/product?id=p1&qty=many', '#/product?id=p1&gift=yes', '#/product?id=p1&color=red', '#/%E0%A4%A'].map(
            (hash) => (parseFragment(hash, SCREENS) as { reason?: string }).reason
        );

        // Assert
        expect(reasons).toEqual([
            'no screen is named "cart"',
            'param "id" of screen "product" is required',
            'param "qty" must be integer on screen "product"',
            'param "gift" must be boolean on screen "product"',
            'param "color" is not declared on screen "product"',
            'the fragment "#/%E0%A4%A" is not valid URL text'
        ]);
    });
});

describe('sameRoute', () => {
    it('should compare the screen and the params', () => {
        // Assert
        expect(sameRoute({ screen: 'home', params: {} }, { screen: 'home', params: {} })).toBe(true);
        expect(sameRoute({ screen: 'product', params: { id: 'a' } }, { screen: 'product', params: { id: 'b' } })).toBe(false);
        expect(sameRoute(undefined, undefined)).toBe(true);
    });
});
