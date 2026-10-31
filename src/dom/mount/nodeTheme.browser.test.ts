import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTokenFallbacks } from '../../build/tokenFallbacks.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { AppDocument, Node } from '../../core/types.js';
import { mountApp } from './index.js';
import type { MountedApp } from './index.js';

function shapeOf(file: string, source: Record<string, unknown>) {
    const result = parseShape({ summary: 'Fixture', ...source }, file);
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const buttonShape = shapeOf('button.state.json', { tokens: { radius: '{radius.md}' } });

defineComponent({
    tag: 'x-nt-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>',
    styles: ':host { display: block; }'
});
defineComponent({
    tag: 'x-nt-button',
    template: '<i>button</i>',
    styles: applyTokenFallbacks(
        ':host { display: block; background: var(--ui-color-accent-base); border-radius: var(--ui-button-radius); }',
        { component: 'button', file: 'button.view.css', tokens: buttonShape.tokens ?? [] }
    )
});

const library: ComponentLibrary = {
    panel: { tier: 'root', tag: 'x-nt-panel', shape: shapeOf('panel.state.json', { properties: { children: { type: 'map', items: 'string', default: {} } } }) },
    button: { tier: 'root', tag: 'x-nt-button', shape: buttonShape }
};

function findAll(root: ParentNode, tag: string): Element[] {
    const found: Element[] = [];
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) found.push(candidate);
        if (candidate.shadowRoot) found.push(...findAll(candidate.shadowRoot, tag));
    }
    return found;
}

const panel = (children: Record<string, Node>): Node => ({ component: 'panel', children }) as unknown as Node;
const button = (theme?: Record<string, unknown>): Node => ({ component: 'button', ...(theme ? { theme } : {}) }) as unknown as Node;

describe('node theme overrides in Chromium', () => {
    const apps: MountedApp[] = [];
    let host: HTMLElement;

    function start(app: Node, extra: Partial<AppDocument> = {}): MountedApp {
        const mounted = mountApp(host, { app, ...extra } as AppDocument, library);
        apps.push(mounted);
        return mounted;
    }

    const buttons = (): HTMLElement[] => findAll(host, 'x-nt-button') as HTMLElement[];
    const background = (element: HTMLElement): string => getComputedStyle(element).backgroundColor;
    const radius = (element: HTMLElement): string => getComputedStyle(element).borderTopLeftRadius;

    beforeEach(() => {
        vi.spyOn(report, 'error').mockImplementation(() => undefined);
        host = window.document.body.appendChild(window.document.createElement('div'));
    });

    afterEach(() => {
        for (const app of apps.splice(0)) app.dispose();
        vi.restoreAllMocks();
        window.document.body.replaceChildren();
    });

    it('should override a semantic token for one subtree while its sibling keeps the app value', () => {
        // Arrange / Act
        const app = start(panel({ a: button({ color: { accent: { base: '#ff0000' } } }), b: button() }));
        const [first, second] = buttons();

        // Assert
        expect(app.errors).toEqual([]);
        expect(background(first as HTMLElement)).toBe('rgb(255, 0, 0)');
        expect(background(second as HTMLElement)).not.toBe('rgb(255, 0, 0)');
    });

    it('should reach buttons in nested shadow roots with a component token', () => {
        // Arrange / Act
        start(panel({ outer: { ...panel({ one: button(), two: button() }), theme: { button: { radius: '0' } } } as Node, other: button() }));
        const all = buttons();

        // Assert
        expect(all).toHaveLength(3);
        expect(all.map(radius)).toEqual(['0px', '0px', '6px']);
    });

    it('should follow a later change of the token an override references', () => {
        // Arrange
        const app = start(panel({ a: button({ color: { accent: { base: '{color.success.base}' } } }) }));
        const [only] = buttons();

        // Act
        app.store?.set('$.theme.tokens.color.success.base', '#123456');

        // Assert
        expect(background(only as HTMLElement)).toBe('rgb(18, 52, 86)');
    });

    it('should restore the inherited value when a key is removed', () => {
        // Arrange
        const app = start(panel({ a: button({ color: { accent: { base: '#ff0000' } } }), b: button() }));
        const [first, second] = buttons();
        const inherited = background(second as HTMLElement);

        // Act
        app.store?.delete('$.app.children.a.theme.color.accent.base');

        // Assert
        expect(background(first as HTMLElement)).toBe(inherited);
    });

    it('should let a semantic override reach a component whose component token is unset', () => {
        // Arrange / Act
        start(panel({ a: button({ radius: { md: '11px' } }), b: button() }));
        const [first, second] = buttons();

        // Assert
        expect(radius(first as HTMLElement)).toBe('11px');
        expect(radius(second as HTMLElement)).toBe('6px');
    });

    it('should not write a primitive override that a state write adds later', () => {
        // Arrange
        const app = start(panel({ a: button() }));
        const [only] = buttons();

        // Act
        app.store?.set('$.app.children.a.theme', { palette: { blue: { 600: '#ff0000' } } });

        // Assert
        expect(only?.style.getPropertyValue('--ui-palette-blue-600')).toBe('');
    });

    it('should stop the run with SUI-THEME-LAYER for a primitive override in the document', () => {
        // Arrange / Act
        const app = start(panel({ a: button({ palette: { blue: { 600: '#ff0000' } } }) }));

        // Assert
        expect(app.store).toBeUndefined();
        expect(app.errors.map((error) => error.code)).toEqual(['SUI-THEME-LAYER']);
    });
});
