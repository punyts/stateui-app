import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prependLayoutSheets } from '../../build/layoutSheets.js';
import { prependSharedSheet } from '../../build/sharedSheet.js';
import { BREAKPOINTS } from '../../core/layout/index.js';
import type { Breakpoint } from '../../core/layout/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from '../mount/index.js';
import type { MountedApp } from '../mount/index.js';

/** What the build does to the CSS of a layout-capable root component before StateUI compiles it */
function withSheets(css: string): string {
    const context = { component: 'panel', file: 'panel.view.css' };
    return prependLayoutSheets(prependSharedSheet(css, context), context);
}

function shapeOf(input: Record<string, unknown>) {
    const result = parseShape({ summary: 'Fixture', events: [], ...input }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const TEMPLATE =
    '<div layout-host=""><sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node></div>';

defineComponent({ tag: 'x-lay-panel', template: TEMPLATE, styles: withSheets('') });
defineComponent({ tag: 'x-lay-padded', template: TEMPLATE, styles: withSheets(':host { padding: 100px; }') });
defineComponent({ tag: 'x-lay-word', template: '<span>{{ $.text }}</span>', styles: ':host { display: block; overflow-wrap: anywhere; }' });
defineComponent({ tag: 'x-lay-box', template: '<i>box</i>', styles: ':host { display: block; min-width: 40px; height: 20px; }' });

const panelShape = { properties: { children: { type: 'map', items: 'string', default: {} } }, layout: true };

const library: ComponentLibrary = {
    panel: { tier: 'root', tag: 'x-lay-panel', shape: shapeOf(panelShape) },
    padded: { tier: 'root', tag: 'x-lay-padded', shape: shapeOf(panelShape) },
    box: { tier: 'root', tag: 'x-lay-box', shape: shapeOf({ properties: {} }) },
    word: { tier: 'root', tag: 'x-lay-word', shape: shapeOf({ properties: { text: { type: 'string', default: '' } } }) }
};

type Children = Record<string, unknown>;

const box = (placement?: Record<string, unknown>) => ({ component: 'box', ...(placement ? { placement } : {}) });

const panel = (layout: Record<string, unknown>, children: Children, component = 'panel') => ({ component, layout, children });

/** Four boxes under keys a to d, with the placement of each given in order */
function four(placements: (Record<string, unknown> | undefined)[] = []): Children {
    return Object.fromEntries(['a', 'b', 'c', 'd'].map((key, index) => [key, box(placements[index])]));
}

function findAll(root: ParentNode, tag: string): Element[] {
    const found: Element[] = [];
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) found.push(candidate);
        if (candidate.shadowRoot) found.push(...findAll(candidate.shadowRoot, tag));
    }
    return found;
}

const layoutHosts = (root: ParentNode): Element[] =>
    findAll(root, 'x-lay-panel')
        .concat(findAll(root, 'x-lay-padded'))
        .map((component) => component.shadowRoot?.querySelector('[layout-host]') as Element);

const rect = (element: Element): DOMRect => element.getBoundingClientRect();

describe('layout sheets in Chromium', () => {
    const apps: MountedApp[] = [];
    let host: HTMLElement;

    function start(app: AppDocument['app'], width?: number): { app: MountedApp; boxes: () => Element[]; layout: () => Element } {
        if (width !== undefined) host.style.width = `${width}px`;
        const mounted = mountApp(host, { app }, library);
        apps.push(mounted);
        expect(mounted.errors).toEqual([]);
        return { app: mounted, boxes: () => findAll(host, 'x-lay-box'), layout: () => layoutHosts(host)[0] as Element };
    }

    beforeEach(() => {
        vi.spyOn(report, 'error').mockImplementation(() => undefined);
        host = document.body.appendChild(document.createElement('div'));
    });

    afterEach(() => {
        for (const mounted of apps.splice(0)) mounted.dispose();
        vi.restoreAllMocks();
        document.body.replaceChildren();
    });

    describe('layout types', () => {
        it('should stack a column in key order with the gap token', () => {
            // Arrange and Act
            const { boxes, layout } = start(panel({ type: 'column', gap: 'md' }, four()), 600);
            const rects = boxes().map(rect);

            // Assert
            expect(getComputedStyle(layout()).display).toBe('flex');
            expect(getComputedStyle(layout()).flexDirection).toBe('column');
            expect(new Set(rects.map((r) => r.left)).size).toBe(1);
            expect(rects.map((r) => r.top)).toEqual([...rects.map((r) => r.top)].sort((a, b) => a - b));
            expect(rects[1]?.top).toBeGreaterThan((rects[0] as DOMRect).bottom);
            expect(getComputedStyle(layout()).rowGap).not.toBe('normal');
        });

        it('should place a row left to right and grow a child', () => {
            // Arrange and Act
            const { boxes, layout } = start(panel({ type: 'row', gap: 'sm' }, four([undefined, { grow: 1 }])), 600);
            const rects = boxes().map(rect);

            // Assert
            expect(getComputedStyle(layout()).flexDirection).toBe('row');
            expect(new Set(rects.map((r) => r.top)).size).toBe(1);
            expect(rects.map((r) => r.left)).toEqual([...rects.map((r) => r.left)].sort((a, b) => a - b));
            expect(rect(boxes()[1] as Element).width).toBeGreaterThan(300);
        });

        it('should squeeze the growing items of a narrow row and keep the others at their width', () => {
            // Arrange
            const label = { component: 'word', text: '#1234' };
            // Rows narrower than the sm breakpoint (480px) wrap, so the narrow row here is 500px and the name longer than it
            const name = { component: 'word', text: 'A customer name that is far too long for the row, and longer still, so that it is wider than five hundred pixels', placement: { grow: 1 } };
            const wide = start(panel({ type: 'row' }, { label }), 600);
            const labelWidth = rect(findAll(host, 'x-lay-word')[0] as Element).width;
            wide.app.dispose();
            document.body.replaceChildren();
            host = document.body.appendChild(document.createElement('div'));

            // Act
            start(panel({ type: 'row' }, { label, name, end: box() }), 500);
            const [labelRect, nameRect] = findAll(host, 'x-lay-word').map(rect);

            // Assert
            expect(labelRect?.width).toBeCloseTo(labelWidth, 0);
            expect(nameRect?.width).toBeLessThan(500 - labelWidth - 40 + 1);
            expect(rect(findAll(host, 'x-lay-box')[0] as Element).width).toBe(40);
        });

        it('should still shrink every item of a row with no growing item', () => {
            // Arrange and Act
            const text = 'A sentence that is much wider than the row, which is 500px so that it does not wrap below the sm breakpoint';
            start(panel({ type: 'row' }, { a: { component: 'word', text }, b: { component: 'word', text } }), 500);
            const rects = findAll(host, 'x-lay-word').map(rect);

            // Assert
            expect((rects[0]?.width ?? 0) + (rects[1]?.width ?? 0)).toBeLessThanOrEqual(500);
        });

        it('should wrap a row only when wrap is set', () => {
            // Arrange
            // Twelve boxes of at least 40px overflow a 500px row, which is wider than the sm breakpoint where rows always wrap
            const twelve = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`b${index}`, box()]));
            const { app, boxes } = start(panel({ type: 'row' }, twelve), 500);
            const before = new Set(boxes().map((element) => rect(element).top)).size;

            // Act
            app.store?.set('$.app.layout.wrap', true);
            const after = new Set(boxes().map((element) => rect(element).top)).size;

            // Assert
            expect(before).toBe(1);
            expect(after).toBeGreaterThan(1);
        });

        it('should align the items of a row', () => {
            // Arrange and Act
            const { boxes, layout } = start(panel({ type: 'row', align: 'end' }, four([undefined, { grow: 0 }])), 600);

            // Assert
            expect(getComputedStyle(layout()).alignItems).toBe('flex-end');
            expect(boxes()).toHaveLength(4);
        });

        it('should lay a grid out in columns from --layout-cols and place children by col and span', () => {
            // Arrange and Act
            const { boxes, layout } = start(panel({ type: 'grid', cols: 3, rows: 2 }, four([{ col: 1 }, { col: 2, span: 2 }, { col: 1, row: 2 }, { col: 3, row: 2 }])), 600);
            const [a, b, c, d] = boxes().map(rect) as [DOMRect, DOMRect, DOMRect, DOMRect];

            // Assert
            expect(getComputedStyle(layout()).gridTemplateColumns.split(' ')).toHaveLength(3);
            expect(getComputedStyle(layout()).gridTemplateRows.split(' ')).toHaveLength(2);
            expect(b.left).toBeGreaterThan(a.left);
            expect(c.left).toBeCloseTo(a.left, 0);
            expect(b.top).toBeCloseTo(a.top, 0);
            expect(c.top).toBeGreaterThan(a.top);
            expect(d.left).toBeGreaterThan(c.left);
            expect(d.top).toBeCloseTo(c.top, 0);
            expect(getComputedStyle(boxes()[1] as Element).gridColumnEnd).toBe('span 2');
            expect(getComputedStyle(boxes()[2] as Element).gridRowStart).toBe('2');
        });

        it('should place the children of a region in their areas', () => {
            // Arrange and Act
            const { boxes, layout } = start(
                panel({ type: 'region' }, four([{ region: 'nw' }, { region: 'ne' }, { region: 'center' }, { region: 'se' }])),
                600
            );
            const [nw, ne, center, se] = boxes().map(rect) as [DOMRect, DOMRect, DOMRect, DOMRect];

            // Assert
            expect(getComputedStyle(layout()).gridTemplateAreas).toBe('"nw n ne" "w center e" "sw s se"');
            expect(getComputedStyle(boxes()[0] as Element).gridArea).toBe('nw');
            expect(getComputedStyle(boxes()[3] as Element).gridArea).toBe('se');
            expect(ne.left).toBeGreaterThan(nw.left);
            expect(ne.top).toBeCloseTo(nw.top, 0);
            expect(center.top).toBeGreaterThanOrEqual(nw.bottom);
            expect(se.top).toBeGreaterThanOrEqual(center.top);
            expect(se.left).toBeGreaterThanOrEqual(center.left);
        });

        it('should position the children of an adhoc layout by x, y, width and height', () => {
            // Arrange and Act
            const { boxes, layout } = start(
                panel({ type: 'adhoc' }, four([{ x: '10px', y: '20px', width: '50px', height: '30px' }, { x: '100px', y: '0' }])),
                600
            );
            const first = getComputedStyle(boxes()[0] as Element);

            // Assert
            expect(getComputedStyle(layout()).position).toBe('relative');
            expect(first.position).toBe('absolute');
            expect([first.left, first.top, first.width, first.height]).toEqual(['10px', '20px', '50px', '30px']);
        });
    });

    describe('state changes', () => {
        it('should rearrange when placement changes', () => {
            // Arrange
            const { app, boxes } = start(panel({ type: 'region' }, four([{ region: 'nw' }, { region: 'ne' }, { region: 'center' }, { region: 'se' }])), 600);
            const before = rect(boxes()[0] as Element);

            // Act
            app.store?.set('$.app.children.a.placement.region', 'se');
            const after = rect(boxes()[0] as Element);

            // Assert
            expect(after.top).toBeGreaterThan(before.top);
            expect(after.left).toBeGreaterThan(before.left);
        });

        it('should place a child by a placement linked to data and follow the data', () => {
            // Arrange
            const app = { component: 'panel', layout: { type: 'adhoc' }, children: { a: { component: 'box', '<-placement': '$.data.spot' } } };
            const mounted = mountApp(host, { app, data: { spot: { x: '10px', y: '20px', width: '50px', z: 3 } } } as AppDocument, library);
            apps.push(mounted);
            const style = (): CSSStyleDeclaration => getComputedStyle(findAll(host, 'x-lay-box')[0] as Element);
            expect(mounted.errors).toEqual([]);
            expect([style().left, style().top, style().width, style().zIndex]).toEqual(['10px', '20px', '50px', '3']);

            // Act
            mounted.store?.set('$.data.spot', { x: '70px', y: '0', width: '80px', z: 5 });

            // Assert
            expect([style().left, style().top, style().width, style().zIndex]).toEqual(['70px', '0px', '80px', '5']);
        });

        it.each([
            ['column', '120px', 120],
            ['row', '90px', 90],
            ['grid', 'calc(50px + 25px)', 75]
        ] as const)('should give a child of a %s the height its placement asks for', (type, height, pixels) => {
            // Arrange and Act
            const { boxes } = start(panel({ type }, { a: box({ height }), b: box() }), 600);

            // Assert
            expect(Math.round(rect(boxes()[0] as Element).height)).toBe(pixels);
        });

        it('should follow the viewport with a height in vh', () => {
            // Arrange and Act
            const { boxes } = start(panel({ type: 'column' }, { a: box({ height: 'calc(50vh - 10px)' }) }), 600);

            // Assert
            expect(Math.round(rect(boxes()[0] as Element).height)).toBe(Math.round(window.innerHeight / 2 - 10));
        });

        it('should cut what reaches past an adhoc area only when clip is set', () => {
            // Arrange
            const children = { a: box({ x: '0px', y: '0px', width: '50px', height: '400px' }) };
            const { app, layout } = start(panel({ type: 'adhoc' }, children), 600);
            const before = getComputedStyle(layout()).overflow;

            // Act
            app.store?.set('$.app.layout.clip', true);

            // Assert
            expect(before).toBe('visible');
            expect(getComputedStyle(layout()).overflow).toBe('clip');
        });

        it('should rearrange when the layout type changes', () => {
            // Arrange
            const { app, boxes, layout } = start(panel({ type: 'column' }, four()), 600);
            const column = new Set(boxes().map((element) => rect(element).top)).size;

            // Act
            app.store?.set('$.app.layout.type', 'row');
            const row = new Set(boxes().map((element) => rect(element).top)).size;

            // Assert
            expect(column).toBe(4);
            expect(row).toBe(1);
            expect(getComputedStyle(layout()).flexDirection).toBe('row');
        });

        it('should change the number of columns when cols changes', () => {
            // Arrange
            const { app, layout } = start(panel({ type: 'grid', cols: 2 }, four()), 600);

            // Act
            app.store?.set('$.app.layout.cols', 4);

            // Assert
            expect(getComputedStyle(layout()).gridTemplateColumns.split(' ')).toHaveLength(4);
        });
    });

    describe('collapseBelow', () => {
        const names = Object.keys(BREAKPOINTS) as Breakpoint[];
        const cases = (['grid', 'row', 'region'] as const).flatMap((type) =>
            names.flatMap((name) => [
                [type, name, BREAKPOINTS[name] - 1, true] as const,
                [type, name, BREAKPOINTS[name], false] as const
            ])
        );
        const placements = { grid: [undefined, undefined, undefined, undefined], row: [], region: [{ region: 'nw' }, { region: 'ne' }, { region: 'center' }, { region: 'se' }] };
        const normal = { grid: 'grid', row: 'flex', region: 'grid' } as const;

        it.each(cases)('should treat a %s with collapseBelow %s at %ipx as collapsed: %s', (type, name, width, collapsed) => {
            // Arrange and Act
            const layout = type === 'grid' ? { type, cols: 2, collapseBelow: name } : { type, collapseBelow: name };
            const { boxes, layout: layoutHost } = start(panel(layout, four(placements[type])), width);
            const style = getComputedStyle(layoutHost());
            const rects = boxes().map(rect);
            const stacked = new Set(rects.map((r) => r.left)).size === 1 && rects.every((r, i) => i === 0 || r.top >= (rects[i - 1] as DOMRect).bottom);

            // Assert
            expect(stacked).toBe(collapsed);
            if (collapsed) {
                expect(style.display).toBe('flex');
                expect(style.flexDirection).toBe('column');
            } else {
                expect(style.display).toBe(normal[type]);
            }
        });

        it.each(['grid', 'row', 'region'] as const)('should never collapse a %s without collapseBelow', (type) => {
            // Arrange and Act
            const layout = type === 'grid' ? { type, cols: 2 } : { type };
            const { layout: layoutHost } = start(panel(layout, four(placements[type])), 100);

            // Assert
            expect(getComputedStyle(layoutHost()).display).toBe(normal[type]);
        });

        it('should stack in key order even when grid placement says otherwise', () => {
            // Arrange and Act
            const { boxes } = start(panel({ type: 'grid', cols: 2, collapseBelow: 'md' }, four([{ col: 2 }, { col: 1 }, { col: 2, row: 3 }, { col: 1, row: 2 }])), 400);
            const tops = boxes().map((element) => rect(element).top);

            // Assert
            expect(tops).toEqual([...tops].sort((a, b) => a - b));
            expect(new Set(boxes().map((element) => rect(element).left)).size).toBe(1);
        });

        it('should let a nested container respond to its own width', () => {
            // Arrange
            const inner = panel({ type: 'row', collapseBelow: 'md' }, four());
            const outer = panel(
                { type: 'grid', cols: 2, collapseBelow: 'md' },
                { left: { ...inner, placement: { col: 1 } }, right: { ...box({ col: 2 }) } }
            );

            // Act
            start(outer, 1000);
            const [outerHost, innerHost] = layoutHosts(host) as [Element, Element];

            // Assert
            expect(getComputedStyle(outerHost).display).toBe('grid');
            expect(getComputedStyle(innerHost).flexDirection).toBe('column');
        });

        it('should keep a wide nested container in a collapsed outer one arranged', () => {
            // Arrange
            const inner = panel({ type: 'row' }, four());
            const outer = panel({ type: 'row', collapseBelow: 'md' }, { only: inner });

            // Act
            start(outer, 500);
            const [outerHost, innerHost] = layoutHosts(host) as [Element, Element];

            // Assert
            expect(getComputedStyle(outerHost).flexDirection).toBe('column');
            expect(getComputedStyle(innerHost).flexDirection).toBe('row');
        });

        it('should follow a change of collapseBelow at runtime', () => {
            // Arrange
            const { app, layout } = start(panel({ type: 'grid', cols: 2, collapseBelow: 'md' }, four()), 700);
            const before = getComputedStyle(layout()).display;

            // Act
            app.store?.set('$.app.layout.collapseBelow', 'sm');
            const lower = getComputedStyle(layout()).display;
            app.store?.set('$.app.layout.collapseBelow', 'xl');
            const higher = getComputedStyle(layout()).display;

            // Assert
            expect([before, lower, higher]).toEqual(['flex', 'grid', 'flex']);
        });

        it('should measure the content width of the component host, without its padding', () => {
            // Arrange and Act
            const wide = start(panel({ type: 'grid', cols: 2, collapseBelow: 'md' }, four(), 'padded'), 900);
            const content = getComputedStyle(wide.layout()).display;

            // Assert
            expect(content).toBe('flex');
        });
    });
});
