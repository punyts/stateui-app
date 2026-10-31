import { createStore } from '@punyts/state';
import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../../core/types.js';
import { switchLocale } from './index.js';

function makeStore() {
    return createStore<Record<string, unknown>>({
        data: { name: 'Ada' },
        theme: { tokens: { color: 'red' }, active: {} },
        locale: 'en',
        app: { _title: 'Orders', children: { a: { _text: 'Name', value: 'x' } } }
    });
}

const EN: JsonObject = { _title: 'Orders', children: { a: { _text: 'Name' } } };
const DE: JsonObject = { _title: 'Aufträge', children: { a: { _text: 'Name (de)' } } };

describe('switchLocale', () => {
    it('should apply the overlay to $.app and set $.locale', () => {
        // Arrange
        const store = makeStore();

        // Act
        const errors = switchLocale(store, 'de', { en: EN, de: DE });

        // Assert
        expect(errors).toEqual([]);
        expect(store.get('$.locale')).toBe('de');
        expect(store.get('$.app')).toEqual({ _title: 'Aufträge', children: { a: { _text: 'Name (de)', value: 'x' } } });
    });

    it('should put the base language back when the base overlay is applied', () => {
        // Arrange
        const store = makeStore();
        switchLocale(store, 'de', { en: EN, de: DE });

        // Act
        switchLocale(store, 'en', { en: EN, de: DE });

        // Assert
        expect(store.get('$.locale')).toBe('en');
        expect(store.get('$.app')).toEqual({ _title: 'Orders', children: { a: { _text: 'Name', value: 'x' } } });
    });

    it('should return SUI-LOCALE and change nothing for a language without an overlay', () => {
        // Arrange
        const store = makeStore();
        const before = JSON.parse(JSON.stringify(store.get('$')));

        // Act
        const errors = switchLocale(store, 'fr', { en: EN, de: DE });
        const inherited = switchLocale(store, 'toString', { en: EN });

        // Assert
        expect(errors.map((error) => error.code)).toEqual(['SUI-LOCALE-UNKNOWN']);
        expect(inherited).toHaveLength(1);
        expect(store.get('$')).toEqual(before);
    });

    it('should leave $.data and $.theme untouched and not share objects with the overlay', () => {
        // Arrange
        const store = makeStore();
        const overlay: JsonObject = { children: { a: { _errors: { required: 'Pflicht' } } } };

        // Act
        switchLocale(store, 'de', { de: overlay });
        (overlay.children as { a: { _errors: JsonObject } }).a._errors.required = 'Changed';

        // Assert
        expect(store.get('$.data')).toEqual({ name: 'Ada' });
        expect(store.get('$.theme')).toEqual({ tokens: { color: 'red' }, active: {} });
        expect(store.get('$.app.children.a._errors.required')).toBe('Pflicht');
    });
});
