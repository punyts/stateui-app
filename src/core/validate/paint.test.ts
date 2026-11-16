import { describe, expect, it } from 'vitest';
import type { ComponentLibrary } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import { themeTokenLookup } from '../theme/index.js';
import type { JsonObject, Node } from '../types.js';
import { validateDocument } from './index.js';

function shapeOf(source: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', ...source }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const SHAPES = ['dot', 'group'];
const paint = { fill: { type: 'string', validators: { color: true } }, stroke: { type: 'string', validators: { color: true } } };
const interaction = { interactive: { type: 'boolean', default: false }, _label: { type: 'string', kind: 'content', default: '' } };

// A fixture drawing, a group that opens no paint scope and a shape: the real ones are in stateui-components
const LIBRARY: ComponentLibrary = {
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({ properties: {}, layout: true }) },
    sketch: {
        tier: 'root',
        tag: 'ui-sketch',
        shape: shapeOf({
            childComponents: SHAPES,
            tokenGroup: 'sketch',
            tokens: { background: '{color.surface.base}' },
            properties: {
                paints: {
                    type: 'map',
                    default: {},
                    items: {
                        kind: { type: 'string', values: ['linear', 'radial'], default: 'linear' },
                        stops: { type: 'map', default: {}, items: { offset: { type: 'number', default: 0 }, color: { type: 'string', validators: { color: true } } } }
                    }
                }
            }
        })
    },
    group: { tier: 'shape', shape: shapeOf({ childComponents: SHAPES, properties: { ...paint } }) },
    dot: { tier: 'shape', shape: shapeOf({ properties: { r: { type: 'number', default: 1 }, ...paint, ...interaction }, events: ['press'] }) }
};

const hasToken = themeTokenLookup(LIBRARY);

function found(app: Node, extra: JsonObject = {}, options: { hasToken?: (name: string) => boolean } = { hasToken }): { code: string; statePath?: string }[] {
    return validateDocument({ app, ...extra }, LIBRARY, options)
        .errors.filter((error) => ['SUI-STATE-PAINT', 'SUI-STATE-TOKEN', 'SUI-STATE-LABEL'].includes(error.code))
        .map((error) => ({ code: error.code, statePath: error.statePath }));
}

const sketch = (children: Record<string, JsonObject>, own: JsonObject = {}): Node =>
    ({ component: 'sketch', paints: { sky: { kind: 'linear', stops: { a: { offset: 0, color: '{color.accent.base}' } } } }, ...own, children }) as Node;

describe('the paint document validator', () => {
    it('should accept literals, known tokens and paint names the drawing defines, at any depth', () => {
        const app = sketch({
            a: { component: 'dot', fill: '#ff0000', stroke: '{color.text.base}' },
            b: { component: 'group', fill: 'sky', children: { c: { component: 'dot', fill: 'sky', stroke: 'transparent' } } }
        });

        expect(found(app)).toEqual([]);
    });

    it('should report a paint name the nearest paints do not define as SUI-STATE-PAINT at the property', () => {
        const app = sketch({ a: { component: 'group', children: { b: { component: 'dot', fill: 'sea' } } } });

        const errors = validateDocument({ app }, LIBRARY, { hasToken }).errors.filter((error) => error.code === 'SUI-STATE-PAINT');

        expect(errors.map((error) => error.statePath)).toEqual(['$.app.children.a.children.b.fill']);
        expect(errors[0]?.message).toBe('Property "fill" at $.app.children.a.children.b.fill names the paint "sea", which the paints of its drawing do not define');
    });

    it('should report an unknown token as SUI-STATE-TOKEN, in a shape and in a gradient stop', () => {
        const app = sketch(
            { a: { component: 'dot', fill: '{color.nope.base}' } },
            { paints: { sky: { stops: { a: { offset: 0, color: '{color.made.up}' } } } } }
        );

        const errors = validateDocument({ app }, LIBRARY, { hasToken }).errors.filter((error) => error.code === 'SUI-STATE-TOKEN');

        expect(errors.map((error) => error.statePath)).toEqual(['$.app.paints.sky.stops.a.color', '$.app.children.a.fill']);
        expect(errors[1]?.message).toBe('Property "fill" at $.app.children.a.fill names the token {color.nope.base}, which is not in the theme');
    });

    it('should know the component tokens of the library and the primitive tokens', () => {
        const app = sketch({ a: { component: 'dot', fill: '{sketch.background}', stroke: '{palette.white}' } });

        expect(found(app)).toEqual([]);
    });

    it('should check tokens by syntax only without hasToken', () => {
        const app = sketch({ a: { component: 'dot', fill: '{color.nope.base}', stroke: 'sea' } });

        expect(found(app, {}, {})).toEqual([{ code: 'SUI-STATE-PAINT', statePath: '$.app.children.a.stroke' }]);
    });

    it('should not read a value given by a link, nor paint names under linked paints', () => {
        const linked = sketch({ a: { component: 'dot', '<-fill': '$.data.fill' } });
        const linkedPaints = { component: 'sketch', '<-paints': '$.data.paints', children: { a: { component: 'dot', fill: 'sea' } } } as Node;

        expect(found(linked, { data: { fill: 'sea' } })).toEqual([]);
        expect(found(linkedPaints, { data: { paints: {} } })).toEqual([]);
    });

    it('should check a screen and leave paint names of a composed tree to where it is used', () => {
        const screens = { home: { root: sketch({ a: { component: 'dot', fill: 'sea' } }) } };
        const composed = { marker: { component: 'dot', fill: 'sea', stroke: '{color.nope.base}' } };

        expect(found({ component: 'panel', children: {} } as Node, { screens, start: 'home', composed })).toEqual([
            { code: 'SUI-STATE-PAINT', statePath: '$.screens.home.children.a.fill' },
            { code: 'SUI-STATE-TOKEN', statePath: '$.composed.marker.stroke' }
        ]);
    });

    it('should check a composed shape where a drawing uses it', () => {
        const app = sketch({ a: { component: 'marker' } });

        expect(found(app, { composed: { marker: { component: 'dot', fill: 'sea' } } })).toEqual([{ code: 'SUI-STATE-PAINT', statePath: '$.app.children.a.fill' }]);
    });
});

describe('the label document validator', () => {
    it('should warn for an interactive shape without a _label, naming the node', () => {
        const app = sketch({ a: { component: 'dot', interactive: true }, b: { component: 'dot', interactive: true, _label: '  ' } });

        const result = validateDocument({ app }, LIBRARY, { hasToken });
        const warnings = result.errors.filter((error) => error.code === 'SUI-STATE-LABEL');

        expect(warnings.map((error) => error.statePath)).toEqual(['$.app.children.a', '$.app.children.b']);
        expect(warnings[0]?.severity).toBe('warning');
        expect(warnings[0]?.message).toBe('Interactive shape "dot" at $.app.children.a has no _label, so keyboard and screen reader users cannot name it');
        expect(result.valid).toBe(true);
    });

    it('should accept an interactive shape with a _label or a linked one, and a shape that is not interactive', () => {
        const app = sketch({
            a: { component: 'dot', interactive: true, _label: 'Seat 1' },
            b: { component: 'dot', interactive: true, '<-_label': '$.data.name' },
            c: { component: 'dot' }
        });

        expect(found(app, { data: { name: 'Seat 2' } })).toEqual([]);
    });
});
