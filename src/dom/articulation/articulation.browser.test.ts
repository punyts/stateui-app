import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prependSharedSheet } from '../../build/sharedSheet.js';
import { ARTICULATION_LISTS } from '../../core/articulation/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import { SHIPPED_OVERLAYS } from '../../core/theme/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from '../mount/index.js';
import { applyOverlay } from '../theme/index.js';
import type { MountedApp } from '../mount/index.js';

/** The fixture component's own CSS: it reads `--tone` and never repeats the tone table */
const BOX_CSS = ':host { display: block; color: var(--tone); height: var(--control-height); }';

/** What the build does to a root component's CSS before StateUI compiles it */
const withSharedSheet = (css: string): string => prependSharedSheet(css, { component: 'box', file: 'box.view.css' });

function shapeOf(input: Record<string, unknown>) {
    const result = parseShape({ summary: 'Fixture', events: [], ...input }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

defineComponent({
    tag: 'x-art-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>',
    styles: withSharedSheet(':host { display: block; }')
});
defineComponent({ tag: 'x-art-box', template: '<i>box</i>', styles: withSharedSheet(BOX_CSS) });

const library: ComponentLibrary = {
    panel: { tier: 'root', tag: 'x-art-panel', shape: shapeOf({ properties: { children: { type: 'map', items: 'string', default: {} } } }) },
    box: {
        tier: 'root',
        tag: 'x-art-box',
        shape: shapeOf({
            properties: { value: { type: 'string', default: '' }, note: { type: 'string', default: '' } },
            shared: { tone: {}, size: {}, elevation: {}, textRole: {} }
        })
    }
};

const panel = (children: Record<string, unknown>) => ({ component: 'panel', children });
const box = (properties: Record<string, unknown> = {}) => ({ component: 'box', ...properties });

/** Every element with the tag below `root`, crossing shadow roots */
function findAll(root: ParentNode, tag: string): Element[] {
    const found: Element[] = [];
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) found.push(candidate);
        if (candidate.shadowRoot) found.push(...findAll(candidate.shadowRoot, tag));
    }
    return found;
}

/** The colour the application root's custom property holds, as the browser computes it */
function tokenColor(host: Element, name: string): string {
    const root = host.querySelector('ui-app-root') as Element;
    const probe = document.body.appendChild(document.createElement('span'));
    probe.style.color = getComputedStyle(root).getPropertyValue(name).trim();
    const result = getComputedStyle(probe).color;
    probe.remove();
    return result;
}

describe('shared articulation in Chromium', () => {
    const apps: MountedApp[] = [];
    let host: HTMLElement;

    function start(app: AppDocument['app']): { app: MountedApp; boxes: () => Element[] } {
        const mounted = mountApp(host, { app }, library);
        apps.push(mounted);
        expect(mounted.errors).toEqual([]);
        return { app: mounted, boxes: () => findAll(host, 'x-art-box') };
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

    it('should keep the tone table out of the fixture component CSS', () => {
        // Arrange
        const tones = ARTICULATION_LISTS.tone.join('|');

        // Act
        const direct = new RegExp(`--ui-color-(${tones})-`).exec(BOX_CSS);

        // Assert
        expect(direct).toBeNull();
    });

    it('should resolve --tone to the danger token three levels deep and follow a token write', () => {
        // Arrange
        const { app, boxes } = start(panel({ outer: panel({ inner: panel({ leaf: box({ tone: 'danger' }) }) }) }));
        const [leaf] = boxes();

        // Act
        const before = getComputedStyle(leaf as Element).color;
        const token = tokenColor(host, '--ui-color-danger-base');
        app.store?.set('$.theme.tokens.color.danger.base', '#fca5a5');
        const after = getComputedStyle(leaf as Element).color;

        // Assert
        expect(boxes()).toHaveLength(1);
        expect(leaf?.getAttribute('tone')).toBe('danger');
        expect(before).toBe(token);
        expect(after).toBe('rgb(252, 165, 165)');
    });

    it('should change the colour when the dark overlay is applied and restore it with light', () => {
        // Arrange
        const { app, boxes } = start(panel({ a: box({ tone: 'danger' }), b: box({ tone: 'accent' }) }));
        const [danger, accent] = boxes() as [Element, Element];
        const light = [getComputedStyle(danger).color, getComputedStyle(accent).color];

        // Act
        const errors = applyOverlay(app.store as Parameters<typeof applyOverlay>[0], 'mode', 'dark', SHIPPED_OVERLAYS);
        const dark = [getComputedStyle(danger).color, getComputedStyle(accent).color];
        applyOverlay(app.store as Parameters<typeof applyOverlay>[0], 'mode', 'light', SHIPPED_OVERLAYS);

        // Assert
        expect(errors).toEqual([]);
        expect(dark[0]).not.toBe(light[0]);
        expect(dark[1]).not.toBe(light[1]);
        expect(getComputedStyle(danger).color).toBe(light[0]);
        expect(getComputedStyle(accent).color).toBe(light[1]);
    });

    it('should change --control-height with the size', () => {
        // Arrange
        const { app, boxes } = start(panel({ one: box({ size: 'sm' }) }));
        const [one] = boxes() as [Element];
        const small = getComputedStyle(one).height;

        // Act
        app.store?.set('$.app.children.one.size', 'lg');
        const large = getComputedStyle(one).height;

        // Assert
        expect(one.getAttribute('size')).toBe('lg');
        expect(parseFloat(small)).toBeGreaterThan(0);
        expect(parseFloat(large)).toBeGreaterThan(parseFloat(small));
    });

    it('should set hidden="" for true, remove it for false and take a hidden element out of layout', () => {
        // Arrange
        const { app, boxes } = start(panel({ one: box({ hidden: true }) }));
        const [one] = boxes() as [Element];
        const hiddenDisplay = getComputedStyle(one).display;
        const hiddenAttribute = one.getAttribute('hidden');

        // Act
        app.store?.set('$.app.children.one.hidden', false);

        // Assert
        expect(hiddenAttribute).toBe('');
        expect(hiddenDisplay).toBe('none');
        expect(one.hasAttribute('hidden')).toBe(false);
        expect(getComputedStyle(one).display).toBe('block');
    });

    it('should write textRole as text-role, change it on a write and remove it with the value', () => {
        // Arrange
        const { app, boxes } = start(panel({ one: box({ textRole: 'heading' }) }));
        const [one] = boxes() as [Element];
        const first = one.getAttribute('text-role');

        // Act
        app.store?.set('$.app.children.one.textRole', 'code');
        const second = one.getAttribute('text-role');
        app.store?.set('$.app.children.one.textRole', undefined);

        // Assert
        expect(first).toBe('heading');
        expect(second).toBe('code');
        expect(one.hasAttribute('text-role')).toBe(false);
    });

    it('should change the tone attribute on a write and remove it when the value goes', () => {
        // Arrange
        const { app, boxes } = start(panel({ one: box({ tone: 'info' }) }));
        const [one] = boxes() as [Element];

        // Act
        app.store?.set('$.app.children.one.tone', 'success');
        const written = one.getAttribute('tone');
        app.store?.set('$.app.children.one.tone', undefined);

        // Assert
        expect(written).toBe('success');
        expect(one.hasAttribute('tone')).toBe(false);
    });

    it('should not reflect a typed value or any property the component does not list', () => {
        // Arrange and Act
        const { boxes } = start(panel({ one: box({ value: 'secret', note: 'n', tone: 'accent' }) }));
        const [one] = boxes() as [Element];

        // Assert
        expect(one.getAttribute('tone')).toBe('accent');
        expect(one.hasAttribute('value')).toBe(false);
        expect(one.hasAttribute('note')).toBe(false);
        expect(one.getAttributeNames().filter((name) => name !== 'state')).toEqual(['tone']);
    });
});
