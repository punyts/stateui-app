import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SYNONYM_GROUPS, createSearchIndex, stem, synonymExpander, tokenize } from '../index.js';
import type { SearchEntry, SearchFields } from '../index.js';

const fields = (partial: Partial<SearchFields>): SearchFields => Object.freeze({ purposes: [], name: [], summary: [], properties: [], ...partial });

const FIXTURE: readonly SearchEntry[] = Object.freeze([
    {
        id: 'dateField',
        fields: fields({ purposes: ['pick a single date', 'enter a birthday or a due date'], name: ['dateField'], summary: ['A labelled date field that writes an ISO date'], properties: ['min', 'max', 'value'] })
    },
    {
        id: 'dateRangeField',
        fields: fields({ purposes: ['pick a start and end date', 'choose a stay from check-in to check-out'], name: ['dateRangeField'], summary: ['A labelled field for a start and end date'], properties: ['start', 'end'] })
    },
    {
        id: 'calendar',
        fields: fields({ purposes: ['show records by day, week or month', 'see what is booked on each day'], name: ['calendar'], summary: ['A calendar of records with dates in month, week and day views'], properties: ['view', 'range'] })
    },
    {
        id: 'table',
        fields: fields({ purposes: ['list records in rows and columns', 'compare entries side by side'], name: ['table'], summary: ['A table over a list of records with sortable columns'], properties: ['columns', 'sort', 'select'] })
    },
    {
        id: 'image',
        fields: fields({ purposes: ['show a photo of a product'], name: ['image'], summary: ['A picture shown from inline data'], properties: ['fit', 'ratio'] })
    },
    {
        id: 'stat',
        fields: fields({ purposes: ['show a headline number with a trend'], name: ['stat'], summary: ['A headline total with a label'], properties: ['value', 'trend'] })
    }
]);

describe('stem', () => {
    it.each([
        ['dates', 'date'],
        ['tables', 'table'],
        ['boxes', 'box'],
        ['entries', 'entry'],
        ['selecting', 'select'],
        ['selected', 'select']
    ])('should give %s and %s the same stem', (left, right) => {
        expect(stem(left)).toBe(stem(right));
    });

    it('should leave class and need unchanged', () => {
        expect(stem('class')).toBe('class');
        expect(stem('need')).toBe('need');
    });

    it('should remove nothing when fewer than three letters would remain', () => {
        expect(stem('bed')).toBe('bed');
        expect(stem('ties')).toBe('ties');
        expect(stem('using')).toBe('using');
    });
});

describe('tokenize', () => {
    it('should split camelCase and non-letters, lowercase and stem', () => {
        expect(tokenize('dateRangeField')).toEqual(['date', 'range', 'field']);
        expect(tokenize('Pick the check-in DATES')).toEqual(['pick', 'check', 'date']);
    });
});

describe('synonyms', () => {
    const pairs = SYNONYM_GROUPS.flatMap((group) => group.flatMap((left) => group.filter((right) => right !== left).map((right) => [left, right] as const)));

    it.each(pairs)('should let a need word %s match %s', (needWord, documentWord) => {
        // Arrange: one entry holds only the other member of the group
        const index = createSearchIndex([{ id: 'only', fields: fields({ purposes: [documentWord] }) }]);

        // Act
        const hits = index.search(needWord);

        // Assert
        expect(hits.map((hit) => hit.id)).toEqual(['only']);
        expect(hits[0]?.matched).toEqual([documentWord]);
    });

    it('should expand a word in no group to itself', () => {
        expect([...synonymExpander()('booking')]).toEqual(['booking']);
    });
});

describe('createSearchIndex', () => {
    const index = createSearchIndex(FIXTURE);

    it('should rank both date fields above the calendar for "pick a date"', () => {
        // Act
        const ids = index.search('pick a date').map((hit) => hit.id);

        // Assert
        expect(ids.indexOf('dateField')).toBeLessThan(ids.indexOf('calendar'));
        expect(ids.indexOf('dateRangeField')).toBeLessThan(ids.indexOf('calendar'));
        expect(ids.slice(0, 2).sort()).toEqual(['dateField', 'dateRangeField']);
    });

    it('should match plural and stemmed forms', () => {
        expect(index.search('entries')[0]?.id).toBe('table');
        expect(index.search('picking dates').map((hit) => hit.id)).toContain('dateField');
    });

    it('should match through a synonym', () => {
        // "picture" is only in image's summary, "photo" in its purpose; "choose" finds the date range by "pick"
        expect(index.search('photo')[0]?.id).toBe('image');
        expect(index.search('choose a date').map((hit) => hit.id).slice(0, 2)).toContain('dateRangeField');
        expect(index.search('sum').map((hit) => hit.id)).toEqual(['stat']);
    });

    it('should score a purpose hit above a summary hit of the same word', () => {
        // Arrange
        const both = createSearchIndex([
            { id: 'inPurpose', fields: fields({ purposes: ['track an invoice'] }) },
            { id: 'inSummary', fields: fields({ summary: ['track an invoice'] }) }
        ]);

        // Act
        const hits = both.search('invoice');

        // Assert
        expect(hits.map((hit) => hit.id)).toEqual(['inPurpose', 'inSummary']);
        expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    });

    it('should rank the entry with the need word in a purpose above one with it in the summary, among others', () => {
        // Act
        const ids = index.search('booked').map((hit) => hit.id);

        // Assert: "booked" is in a calendar purpose only
        expect(ids[0]).toBe('calendar');
    });

    it('should give the same order twice', () => {
        expect(index.search('show records')).toEqual(index.search('show records'));
    });

    it('should return nothing for an empty need, a blank need, stop words only or no match', () => {
        expect(index.search('')).toEqual([]);
        expect(index.search('   ')).toEqual([]);
        expect(index.search('the of a')).toEqual([]);
        expect(index.search('spaceship')).toEqual([]);
    });

    it('should list the purpose phrases verbatim, then the words matched only elsewhere', () => {
        // Act
        const hit = index.search('pick a date view').find((candidate) => candidate.id === 'calendar');
        const dateHit = index.search('pick a date').find((candidate) => candidate.id === 'dateRangeField');

        // Assert
        expect(dateHit?.matched).toEqual(['pick a start and end date', 'choose a stay from check-in to check-out']);
        expect(hit?.matched).toEqual(['date', 'view']);
    });

    it('should break ties by the number of need words matched, then by id', () => {
        // Arrange: same field lengths, so each single match scores the same
        const tied = createSearchIndex([
            { id: 'b', fields: fields({ purposes: ['alpha'] }) },
            { id: 'a', fields: fields({ purposes: ['alpha'] }) }
        ]);

        // Act and assert
        expect(tied.search('alpha').map((hit) => hit.id)).toEqual(['a', 'b']);
    });

    it('should cut the ranking at the limit and report its size', () => {
        expect(index.search('show records', 1)).toHaveLength(1);
        expect(index.size).toBe(FIXTURE.length);
    });
});

describe('search module', () => {
    it('should import nothing outside src/core/search', () => {
        // Arrange
        const folder = dirname(fileURLToPath(import.meta.url));
        const sources = readdirSync(folder).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

        // Act
        const imports = sources.flatMap((name) => [...readFileSync(join(folder, name), 'utf8').matchAll(/from '([^']+)'/g)].map((match) => match[1]));

        // Assert
        expect(imports.filter((specifier) => !specifier?.startsWith('./'))).toEqual([]);
    });
});
