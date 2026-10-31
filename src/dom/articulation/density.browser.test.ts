import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prependSharedSheet } from '../../build/sharedSheet.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from '../mount/index.js';
import type { MountedApp } from '../mount/index.js';

/** The nine space tokens that depend on the density factor, read by one fixture field each */
const SPACE_TOKENS = ['inset', 'gap', 'stack'].flatMap((group) => ['sm', 'md', 'lg'].map((step) => `${group}-${step}`));

const FIELD_CSS = ':host { display: block; padding: var(--ui-space-inset-md); margin-bottom: var(--ui-space-stack-sm); gap: var(--ui-space-gap-lg); }';

const withSharedSheet = (css: string, component: string): string =>
    prependSharedSheet(css, { component, file: `${component}.view.css` });

function shapeOf(input: Record<string, unknown>) {
    const result = parseShape({ summary: 'Fixture', events: [], ...input }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

defineComponent({
    tag: 'x-den-form',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>',
    styles: withSharedSheet(':host { display: block; }', 'form')
});
defineComponent({ tag: 'x-den-field', template: '<i>field</i>', styles: withSharedSheet(FIELD_CSS, 'field') });

const library: ComponentLibrary = {
    form: {
        tier: 'root',
        tag: 'x-den-form',
        shape: shapeOf({
            properties: { children: { type: 'map', items: 'string', default: {} } },
            shared: { density: {} }
        })
    },
    field: { tier: 'root', tag: 'x-den-field', shape: shapeOf({ properties: {} }) }
};

const form = (children: Record<string, unknown>, density?: string) => ({
    component: 'form',
    children,
    ...(density === undefined ? {} : { density })
});
const field = () => ({ component: 'field' });

/** Every element with the tag below `root`, crossing shadow roots */
function findAll(root: ParentNode, tag: string): Element[] {
    const found: Element[] = [];
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) found.push(candidate);
        if (candidate.shadowRoot) found.push(...findAll(candidate.shadowRoot, tag));
    }
    return found;
}

const padding = (element: Element): number => parseFloat(getComputedStyle(element).paddingTop);

describe('density in Chromium', () => {
    const apps: MountedApp[] = [];
    let host: HTMLElement;

    function start(app: AppDocument['app']): { app: MountedApp; fields: () => Element[] } {
        const target = host.appendChild(document.createElement('div'));
        const mounted = mountApp(target, { app }, library);
        apps.push(mounted);
        expect(mounted.errors).toEqual([]);
        return { app: mounted, fields: () => findAll(target, 'x-den-field') };
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

    const tree = (density?: string) => form({ one: form({ two: form({ leaf: field() }) }) }, density);

    it('should give fields three shadow roots deep 0.75 times the default padding under a compact form', () => {
        // Arrange
        const base = start(tree());
        const fallback = padding(base.fields()[0] as Element);
        const compact = start(tree('compact'));

        // Act
        const [leaf] = compact.fields().slice(-1);

        // Assert
        expect(fallback).toBeGreaterThan(0);
        expect(padding(leaf as Element)).toBeCloseTo(fallback * 0.75, 3);
    });

    it('should give a spacious container inside a compact one 1.25 times the default padding', () => {
        // Arrange
        const base = start(tree());
        const fallback = padding(base.fields()[0] as Element);
        const { fields } = start(form({ one: form({ two: form({ leaf: field() }, 'spacious') }) }, 'compact'));

        // Act
        const [leaf] = fields();

        // Assert
        expect(padding(leaf as Element)).toBeCloseTo(fallback * 1.25, 3);
    });

    it('should restore the default padding when density is removed at runtime', () => {
        // Arrange
        const base = start(tree());
        const fallback = padding(base.fields()[0] as Element);
        const { app, fields } = start(tree('compact'));
        const leaf = fields()[0] as Element;
        const compact = padding(leaf);

        // Act
        app.store?.set('$.app.density', undefined);
        const restored = padding(leaf);
        app.store?.set('$.app.density', 'spacious');
        const spacious = padding(leaf);

        // Assert
        expect(compact).toBeCloseTo(fallback * 0.75, 3);
        expect(restored).toBeCloseTo(fallback, 3);
        expect(spacious).toBeCloseTo(fallback * 1.25, 3);
    });

    it('should change the compact spacing under the host when density.compact changes in the tokens', () => {
        // Arrange
        const base = start(tree());
        const fallback = padding(base.fields()[0] as Element);
        const { app, fields } = start(tree('compact'));
        const leaf = fields()[0] as Element;

        // Act
        app.store?.set('$.theme.tokens.density.compact', '0.5');
        const changed = padding(leaf);

        // Assert
        expect(changed).toBeCloseTo(fallback * 0.5, 3);
    });

    it.each(SPACE_TOKENS)('should re-declare space token %s on a compact host', (name) => {
        // Arrange
        const base = start(tree());
        const rootValue = getComputedStyle(base.fields()[0] as Element).getPropertyValue(`--ui-space-${name}`);
        const compact = start(tree('compact'));

        // Act
        const value = getComputedStyle(compact.fields()[0] as Element).getPropertyValue(`--ui-space-${name}`);

        // Assert
        expect(rootValue).not.toBe('');
        expect(value).not.toBe(rootValue);
    });
});
