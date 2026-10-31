import { describe, expect, it } from 'vitest';
import { ARTICULATION_LISTS, ARTICULATION_NAMES, SHARED_NAMES, attributeName, closedList, isArticulationName, isSharedName } from './index.js';

describe('closed lists', () => {
    it.each([
        ['tone', ['neutral', 'accent', 'danger', 'warning', 'success', 'info']],
        ['variant', ['solid', 'soft', 'outline', 'ghost', 'link']],
        ['size', ['sm', 'md', 'lg']],
        ['density', ['compact', 'comfortable', 'spacious']],
        ['elevation', ['flat', 'raised', 'overlay']],
        ['textRole', ['display', 'title', 'heading', 'body', 'label', 'caption', 'code']]
    ] as const)('holds the values of %s', (name, values) => {
        // Arrange and Act
        const list = closedList(name);

        // Assert
        expect(list).toEqual(values);
        expect(ARTICULATION_LISTS[name]).toEqual(values);
    });

    it('lists the six shared names and adds hidden to the articulation names', () => {
        // Assert
        expect(SHARED_NAMES).toEqual(['tone', 'variant', 'size', 'density', 'elevation', 'textRole']);
        expect(ARTICULATION_NAMES).toEqual([...SHARED_NAMES, 'hidden']);
    });

    it('returns a copy the caller may change', () => {
        // Arrange
        const list = closedList('size');

        // Act
        list.push('xl');

        // Assert
        expect(closedList('size')).toEqual(['sm', 'md', 'lg']);
    });

    it('tells shared names from hidden and other names', () => {
        // Assert
        expect(isSharedName('tone')).toBe(true);
        expect(isSharedName('hidden')).toBe(false);
        expect(isSharedName('toString')).toBe(false);
        expect(isArticulationName('hidden')).toBe(true);
        expect(isArticulationName('width')).toBe(false);
    });
});

describe('attributeName', () => {
    it('gives textRole the attribute text-role', () => {
        // Assert
        expect(attributeName('textRole')).toBe('text-role');
    });

    it.each(ARTICULATION_NAMES.filter((name) => name !== 'textRole'))('leaves %s unchanged', (name) => {
        // Assert
        expect(attributeName(name)).toBe(name);
    });
});
