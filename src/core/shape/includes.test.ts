import { describe, expect, it } from 'vitest';
import { parseShape } from './index.js';

const FILE = 'atoms/rect/rect.state.json';

const PAINT = {
    properties: {
        fill: { type: 'string', validators: { color: true }, default: '{color.accent.base}' },
        stroke: { type: 'string', validators: { color: true }, default: 'none' }
    },
    events: ['press', 'hover'],
    tokens: { stroke: '{color.text.base}' }
};

const MOTION = {
    properties: { transition: { type: 'number', default: 0 } },
    events: ['hover', 'dragEnd']
};

const partials = new Map<string, unknown>([
    ['paint', JSON.stringify(PAINT)],
    ['motion', MOTION]
]);

function errorsOf(json: Record<string, unknown>, options = { partials }): string[] {
    return parseShape({ summary: 'A rectangle', ...json }, FILE, options).errors.map((error) => `${error.code} ${error.message}`);
}

describe('parseShape includes', () => {
    it('should merge the properties, events and tokens of each included partial under the own ones', () => {
        const result = parseShape(
            { summary: 'A rectangle', includes: ['paint', 'motion'], tokenGroup: 'rect', events: ['press'], properties: { width: { type: 'number', default: 10 } } },
            FILE,
            { partials }
        );

        expect(result.errors).toEqual([]);
        expect(Object.keys(result.shape?.properties ?? {})).toEqual(['width', 'fill', 'stroke', 'transition', 'hidden']);
        expect(result.shape?.events).toEqual(['press', 'hover', 'dragEnd']);
        expect(result.shape?.tokens?.map((token) => token.path)).toEqual(['rect.stroke']);
    });

    it('should give the same shape as the state file written out in full', () => {
        const included = parseShape({ summary: 'A rectangle', includes: ['paint'], tokenGroup: 'rect', properties: { width: { type: 'number' } } }, FILE, { partials });
        const full = parseShape(
            {
                summary: 'A rectangle',
                tokenGroup: 'rect',
                properties: { width: { type: 'number' }, ...PAINT.properties },
                events: PAINT.events,
                tokens: PAINT.tokens
            },
            FILE
        );

        expect(included.errors).toEqual([]);
        expect(included.shape).toEqual(full.shape);
    });

    it('should let an own property and token win over an included one', () => {
        const result = parseShape(
            { summary: 'A rectangle', includes: ['paint'], tokenGroup: 'rect', properties: { fill: { type: 'string', default: 'red' } }, tokens: { stroke: '{color.text.muted}' } },
            FILE,
            { partials }
        );

        expect(result.errors).toEqual([]);
        expect(result.shape?.properties.fill).toMatchObject({ type: 'string', default: 'red' });
        expect(result.shape?.properties.fill?.validators ?? {}).toEqual({});
        expect(Object.keys(result.shape?.properties ?? {})).toEqual(['fill', 'stroke', 'hidden']);
        expect(result.shape?.tokens?.find((token) => token.path === 'rect.stroke')?.default).toBe('{color.text.muted}');
    });

    it('should report an unknown partial as SUI-BUILD-SHAPE', () => {
        expect(errorsOf({ includes: ['paint', 'glow'] })).toEqual([`SUI-BUILD-SHAPE Invalid shape file ${FILE}: includes: unknown partial "glow"`]);
        expect(errorsOf({ includes: ['paint'] }, { partials: undefined as never })).toEqual([`SUI-BUILD-SHAPE Invalid shape file ${FILE}: includes: unknown partial "paint"`]);
    });

    it('should refuse an includes list that is not unique partial names', () => {
        for (const includes of ['paint', ['paint', 'paint'], ['../paint'], ['paint.json'], [1]]) {
            expect(errorsOf({ includes })).toEqual([`SUI-BUILD-SHAPE Invalid shape file ${FILE}: includes`]);
        }
    });

    it('should refuse a partial that is not an object of properties, events and tokens', () => {
        const bad = new Map<string, unknown>([
            ['text', '{ nope'],
            ['list', []],
            ['extra', { properties: {}, commands: ['focus'] }],
            ['nested', { includes: ['paint'] }],
            ['events', { events: [1] }]
        ]);

        for (const name of bad.keys()) {
            const errors = errorsOf({ includes: [name] }, { partials: bad });
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain(`includes: partial "${name}"`);
        }
    });

    it('should refuse a property two partials both declare', () => {
        const both = new Map<string, unknown>([...partials, ['fill', { properties: { fill: { type: 'string' } } }]]);

        expect(errorsOf({ includes: ['paint', 'fill'] }, { partials: both })).toEqual([
            `SUI-BUILD-SHAPE Invalid shape file ${FILE}: includes: property "fill" is in the partials "paint" and "fill"`
        ]);
    });

    it('should check the included properties as its own', () => {
        const broken = new Map<string, unknown>([['broken', { properties: { size: { type: 'pixels' } } }]]);

        expect(parseShape({ summary: 'A rectangle', includes: ['broken'] }, FILE, { partials: broken }).errors.length).toBeGreaterThan(0);
    });
});
