import { describe, expect, it } from 'vitest';
import type { ComponentLibrary } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import { validateDocument } from '../validate/index.js';
import { LAYOUTS, LAYOUT_TYPES, fitsField, isLayoutType } from './index.js';

function shapeOf(input: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', ...input }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const LIBRARY: ComponentLibrary = {
    text: { tier: 'root', tag: 'ui-text', shape: shapeOf({ properties: { _value: { type: 'string', kind: 'content', default: '' } } }) },
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({ layout: true }) },
    tabs: {
        tier: 'root',
        tag: 'ui-tabs',
        shape: shapeOf({
            placement: {
                _tab: { type: 'string', kind: 'content', required: true },
                icon: { type: 'icon' },
                badge: { type: ['string', 'number'] }
            }
        })
    }
};

function codes(app: Record<string, unknown>, composed?: Record<string, unknown>): string[] {
    const document = composed === undefined ? { app } : { app, composed };
    return validateDocument(document, LIBRARY).errors.map((error) => error.code);
}

function panel(layout: unknown, placement?: unknown): Record<string, unknown> {
    const child = placement === undefined ? { component: 'text' } : { component: 'text', placement };
    return { component: 'panel', layout, children: { a: child } };
}

describe('layout lists', () => {
    it('should list the five layout types', () => {
        expect(LAYOUT_TYPES).toEqual(['column', 'row', 'grid', 'region', 'adhoc']);
        expect(isLayoutType('grid')).toBe(true);
        expect(isLayoutType('flex')).toBe(false);
    });

    it('should give the settings and placement of each type', () => {
        const names = (type: keyof typeof LAYOUTS, key: 'settings' | 'placement'): string[] => Object.keys(LAYOUTS[type][key]);

        expect(names('column', 'settings')).toEqual(['gap', 'align']);
        expect(names('row', 'settings')).toEqual(['gap', 'align', 'wrap', 'collapseBelow']);
        expect(names('grid', 'settings')).toEqual(['cols', 'rows', 'gap', 'collapseBelow']);
        expect(names('region', 'settings')).toEqual(['gap', 'collapseBelow']);
        expect(names('adhoc', 'settings')).toEqual([]);
        expect(names('grid', 'placement')).toEqual(['col', 'row', 'span', 'rowSpan']);
        expect(names('region', 'placement')).toEqual(['region']);
        expect(names('adhoc', 'placement')).toEqual(['x', 'y', 'width', 'height']);
    });

    it.each([
        ['4px', true],
        ['1.5rem', true],
        ['50%', true],
        ['0', true],
        ['calc(1px + 2px)', false],
        ['{scale.space.3}', false],
        ['4em', false],
        [' 4px', false],
        [4, false]
    ])('should check the dimension %j as %s', (value, expected) => {
        expect(fitsField({ type: 'dimension' }, value)).toBe(expected);
    });

    it.each([
        [{ type: 'integer', min: 1, max: 12 } as const, 12, true],
        [{ type: 'integer', min: 1, max: 12 } as const, 13, false],
        [{ type: 'integer', min: 1, max: 12 } as const, 0, false],
        [{ type: 'integer', min: 1, max: 12 } as const, 1.5, false],
        [{ type: 'number', min: 0, max: 12 } as const, 0.5, true],
        [{ type: 'number', min: 0, max: 12 } as const, -1, false],
        [{ type: 'boolean' } as const, 'yes', false]
    ])('should check numeric and boolean specs', (spec, value, expected) => {
        expect(fitsField(spec, value)).toBe(expected);
    });
});

describe('layout validator', () => {
    it.each([
        [{ type: 'column', gap: 'md', align: 'stretch' }, undefined],
        [{ type: 'row', gap: 'none', align: 'center', wrap: true, collapseBelow: 'sm' }, { grow: 2 }],
        [{ type: 'grid', cols: 3, rows: 12, gap: 'lg', collapseBelow: 'xl' }, { col: 1, row: 2, span: 2, rowSpan: 3 }],
        [{ type: 'region', gap: 'sm', collapseBelow: 'md' }, { region: 'nw' }],
        [{ type: 'adhoc' }, { x: '4px', y: '0', width: '50%', height: '2rem' }]
    ])('should accept the layout %j', (layout, placement) => {
        expect(codes(panel(layout, placement))).toEqual([]);
    });

    it.each([
        [{ type: 'flex' }, 'SUI-LAYOUT-TYPE'],
        [{ gap: 'md' }, 'SUI-LAYOUT-TYPE'],
        ['grid', 'SUI-LAYOUT-SHAPE'],
        [{ type: 'column', cols: 3 }, 'SUI-LAYOUT-SETTING'],
        [{ type: 'column', gap: 'xl' }, 'SUI-LAYOUT-VALUE'],
        [{ type: 'grid', cols: 13 }, 'SUI-LAYOUT-VALUE'],
        [{ type: 'row', wrap: 'yes' }, 'SUI-LAYOUT-VALUE'],
        [{ type: 'column', collapseBelow: 'md' }, 'SUI-LAYOUT-SETTING'],
        [{ type: 'adhoc', collapseBelow: 'md' }, 'SUI-LAYOUT-SETTING'],
        [{ type: 'adhoc', gap: 'md' }, 'SUI-LAYOUT-SETTING'],
        [{ type: 'grid', collapseBelow: 'xs' }, 'SUI-LAYOUT-VALUE']
    ])('should reject the layout %j with %s', (layout, code) => {
        expect(codes(panel(layout))).toEqual([code]);
    });

    it('should name the settings of the layout type in the message of an unknown setting', () => {
        // Arrange
        const document = { app: { component: 'panel', layout: { type: 'column', wrap: true }, children: { a: { component: 'text' } } } };

        // Act
        const errors = validateDocument(document, LIBRARY).errors;

        // Assert
        expect(errors.map((error) => error.code)).toEqual(['SUI-LAYOUT-SETTING']);
        expect(errors[0]?.message).toBe('Unknown layout setting "wrap" at $.app.layout.wrap: the column layout takes "type", "gap", "align"');
    });

    it('should say an adhoc layout takes only its type', () => {
        // Arrange and Act
        const errors = validateDocument({ app: { component: 'panel', layout: { type: 'adhoc', gap: 'md' } } }, LIBRARY).errors;

        // Assert
        expect(errors[0]?.message).toBe('Unknown layout setting "gap" at $.app.layout.gap: the adhoc layout takes only "type"');
    });

    it('should reject a layout on a component whose shape does not support it', () => {
        const errors = validateDocument({ app: { component: 'text', layout: { type: 'column' } } }, LIBRARY).errors;

        expect(errors.map((error) => error.code)).toEqual(['SUI-LAYOUT-UNSUPPORTED']);
        expect(errors[0]?.statePath).toBe('$.app.layout');
        expect(errors[0]?.message).toContain('"text"');
    });

    it('should check the nested layout of a composed component', () => {
        const composed = { card: { component: 'panel', layout: { type: 'grid', cols: 0 }, children: { a: { component: 'text' } } } };

        expect(codes({ component: 'card' }, composed)).toContain('SUI-LAYOUT-VALUE');
        expect(codes({ component: 'text' }, composed)).toEqual(['SUI-LAYOUT-VALUE']);
    });
});

describe('placement validator', () => {
    it.each([
        [{ type: 'column' }, { region: 'n' }],
        [{ type: 'grid' }, { x: '1px' }],
        [{ type: 'region' }, { col: 1 }],
        [{ type: 'adhoc' }, { grow: 1 }],
        [{ type: 'grid' }, { unknown: 1 }]
    ])('should reject a placement field that does not fit the layout %j', (layout, placement) => {
        expect(codes(panel(layout, placement))).toEqual(['SUI-LAYOUT-FIELD']);
    });

    it.each([
        [{ type: 'grid' }, { col: 0 }],
        [{ type: 'grid' }, { span: 2.5 }],
        [{ type: 'region' }, { region: 'middle' }],
        [{ type: 'column' }, { grow: 13 }],
        [{ type: 'adhoc' }, { x: 'calc(1px + 2px)' }],
        [{ type: 'adhoc' }, { width: '{scale.space.3}' }]
    ])('should reject a placement value outside its list for %j', (layout, placement) => {
        expect(codes(panel(layout, placement))).toEqual(['SUI-LAYOUT-PLACEMENT']);
    });

    it('should reject a placement that is not an object', () => {
        expect(codes(panel({ type: 'column' }, 'n'))).toEqual(['SUI-LAYOUT-SHAPE']);
    });

    it('should name the parent when it has neither a layout nor a placement shape', () => {
        const errors = validateDocument({ app: { component: 'panel', children: { a: { component: 'text', placement: { col: 1 } } } } }, LIBRARY).errors;

        expect(errors.map((error) => error.code)).toEqual(['SUI-LAYOUT-PARENT']);
        expect(errors[0]?.message).toContain('"panel"');
        expect(errors[0]?.message).toContain('$.app');
        expect(errors[0]?.statePath).toBe('$.app.children.a.placement');
    });

    it('should reject a placement on the app root', () => {
        expect(codes({ component: 'text', placement: { col: 1 } })).toEqual(['SUI-LAYOUT-ROOT']);
    });

    it('should accept a tabs child with _tab, icon and badge', () => {
        const child = { component: 'text', placement: { _tab: 'Home', icon: 'home', badge: 3 } };

        expect(codes({ component: 'tabs', children: { a: child } })).toEqual([]);
        expect(codes({ component: 'tabs', children: { a: { ...child, placement: { _tab: 'Home', badge: 'new' } } } })).toEqual([]);
    });

    it('should reject an unknown, mistyped or missing field under a declared placement shape', () => {
        const tabs = (placement?: Record<string, unknown>): string[] =>
            codes({ component: 'tabs', children: { a: placement === undefined ? { component: 'text' } : { component: 'text', placement } } });

        expect(tabs({ _tab: 'Home', col: 1 })).toEqual(['SUI-LAYOUT-FIELD']);
        expect(tabs({ _tab: 5 })).toEqual(['SUI-LAYOUT-PLACEMENT']);
        expect(tabs({ _tab: 'Home', badge: true })).toEqual(['SUI-LAYOUT-PLACEMENT']);
        expect(tabs({ icon: 'home' })).toEqual(['SUI-LAYOUT-REQUIRED']);
        expect(tabs()).toEqual(['SUI-LAYOUT-REQUIRED']);
    });

    it('should check placements inside a composed component against its own layout', () => {
        const composed = {
            card: { component: 'panel', layout: { type: 'grid' }, children: { a: { component: 'text', placement: { region: 'n' } } } }
        };

        expect(codes({ component: 'card' }, composed)).toContain('SUI-LAYOUT-FIELD');
        expect(codes({ component: 'text' }, composed)).toEqual(['SUI-LAYOUT-FIELD']);
    });

    it('should accept a composed root that carries a default placement when it is placed in a grid', () => {
        const composed = { cell: { component: 'text', placement: { col: 2 } } };
        const app = { component: 'panel', layout: { type: 'grid' }, children: { a: { component: 'cell' } } };

        expect(codes(app, composed)).toEqual([]);
    });
});

describe('placement shape in parseShape', () => {
    const parse = (input: Record<string, unknown>): string[] => parseShape({ summary: 'Test', ...input }, 'f.state.json').errors.map((error) => error.code);

    it('should read the placement shape of a component', () => {
        const shape = shapeOf({ placement: { _tab: { type: 'string', kind: 'content' }, badge: { type: ['string', 'number'] } } });

        expect(Object.keys(shape.placement ?? {})).toEqual(['_tab', 'badge']);
        expect(shape.placement?.['_tab']?.kind).toBe('content');
    });

    it('should leave placement absent when the shape declares none', () => {
        expect(shapeOf({}).placement).toBeUndefined();
    });

    it('should reject a shape with both layout and placement', () => {
        expect(parse({ layout: true, placement: { icon: { type: 'icon' } } })).toEqual(['SUI-BUILD-SHAPE']);
    });

    it.each([
        [{}, 'SUI-BUILD-SHAPE'],
        [{ _tab: { type: 'string' } }, 'SUI-BUILD-KIND'],
        [{ icon: { type: 'bogus' } }, 'SUI-BUILD-SHAPE'],
        [{ icon: { type: 'icon', reflect: true } }, 'SUI-BUILD-SHAPE'],
        [{ 'bad name': { type: 'string' } }, 'SUI-BUILD-NAME']
    ])('should check placement %j like any sub-shape', (placement, code) => {
        expect(parse({ placement })).toEqual([code]);
    });

    it('should reject a placement that is not an object', () => {
        expect(parse({ placement: true })).toEqual(['SUI-BUILD-SHAPE']);
    });
});
