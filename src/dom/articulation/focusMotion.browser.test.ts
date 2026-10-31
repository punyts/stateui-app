import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp } from 'vitest/browser';
import { prependSharedSheet } from '../../build/sharedSheet.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import { SHIPPED_OVERLAYS } from '../../core/theme/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from '../mount/index.js';
import type { MountedApp } from '../mount/index.js';
import { applyOverlay } from '../theme/index.js';

const FIXTURE_CSS =
    ':host { display: block; } button { transition-property: transform; transition-duration: var(--ui-motion-duration-base); }';

defineComponent({
    tag: 'x-fm-box',
    template: '<button>go</button>',
    styles: prependSharedSheet(FIXTURE_CSS, { component: 'box', file: 'box.view.css' })
});

const shape = parseShape({ summary: 'Fixture', properties: {}, events: [] }, 'fixture.state.json').shape;
if (!shape) throw new Error('fixture shape');
const library: ComponentLibrary = { box: { tier: 'root', tag: 'x-fm-box', shape } };

/** The colour the browser computes for a CSS colour expression, such as a system colour or a custom property value */
function resolveColor(expression: string): string {
    const probe = document.body.appendChild(document.createElement('span'));
    probe.style.color = expression;
    const result = getComputedStyle(probe).color;
    probe.remove();
    return result;
}

describe('focus, forced colors and motion in Chromium', () => {
    const apps: MountedApp[] = [];
    let host: HTMLElement;

    function start(app: AppDocument['app'] = {}): { app: MountedApp; box: HTMLElement; button: HTMLButtonElement } {
        const mounted = mountApp(host, { app: { ...app, component: 'box' } as AppDocument['app'] }, library);
        apps.push(mounted);
        expect(mounted.errors).toEqual([]);
        const box = host.querySelector('ui-app-root')?.querySelector('x-fm-box') ?? findBox(host);
        const button = (box as HTMLElement).shadowRoot?.querySelector('button') as HTMLButtonElement;
        return { app: mounted, box: box as HTMLElement, button };
    }

    function findBox(root: ParentNode): Element {
        for (const candidate of Array.from(root.querySelectorAll('*'))) {
            if (candidate.localName === 'x-fm-box') return candidate;
            const inner = candidate.shadowRoot ? findBox(candidate.shadowRoot) : undefined;
            if (inner) return inner;
        }
        throw new Error('no x-fm-box');
    }

    beforeEach(() => {
        vi.spyOn(report, 'error').mockImplementation(() => undefined);
        host = document.body.appendChild(document.createElement('div'));
    });

    afterEach(async () => {
        for (const mounted of apps.splice(0)) mounted.dispose();
        vi.restoreAllMocks();
        document.body.replaceChildren();
        await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });
    });

    it('should draw the token width, offset and colour on a focused control inside the shadow root', () => {
        // Arrange
        const { button, box } = start();
        const focusColor = resolveColor(getComputedStyle(host.querySelector('ui-app-root') as Element).getPropertyValue('--ui-color-focus'));

        // Act
        const before = getComputedStyle(button).outlineStyle;
        button.focus();
        const style = getComputedStyle(button);

        // Assert
        expect(box.shadowRoot?.activeElement).toBe(button);
        expect(before).toBe('none');
        expect(style.outlineStyle).toBe('solid');
        expect(style.outlineWidth).toBe('2px');
        expect(style.outlineOffset).toBe('2px');
        expect(style.outlineColor).toBe(focusColor);
    });

    it('should draw the same outline on a focusable host', () => {
        // Arrange
        const { box } = start();
        box.tabIndex = 0;
        const focusColor = resolveColor(getComputedStyle(host.querySelector('ui-app-root') as Element).getPropertyValue('--ui-color-focus'));

        // Act
        box.focus();
        const style = getComputedStyle(box);

        // Assert
        expect(style.outlineStyle).toBe('solid');
        expect(style.outlineWidth).toBe('2px');
        expect(style.outlineColor).toBe(focusColor);
    });

    it('should follow a change of the focus token', () => {
        // Arrange
        const { app, button } = start();
        button.focus();

        // Act
        app.store?.set('$.theme.tokens.focus.width', '4px');

        // Assert
        expect(getComputedStyle(button).outlineWidth).toBe('4px');
    });

    it('should draw the focus outline as Highlight when forced colors are emulated', async (context) => {
        // Arrange
        try {
            await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
        } catch (error) {
            context.skip(`the browser provider cannot emulate forced colors: ${String(error)}`);
        }
        if (!matchMedia('(forced-colors: active)').matches) {
            context.skip('the browser provider did not apply forced-colors emulation; the stylesheet text test is the check');
        }
        const { button } = start();

        // Act
        button.focus();

        // Assert
        expect(getComputedStyle(button).outlineColor).toBe(resolveColor('Highlight'));
    });

    it('should give a fixture transition the motion token duration, and 0 with motion reduced', () => {
        // Arrange
        const { app, button } = start();
        const full = getComputedStyle(button).transitionDuration;

        // Act
        const errors = applyOverlay(app.store as Parameters<typeof applyOverlay>[0], 'motion', 'reduced', SHIPPED_OVERLAYS);
        const reduced = getComputedStyle(button).transitionDuration;

        // Assert
        expect(errors).toEqual([]);
        expect(full).not.toBe('0s');
        expect(reduced).toBe('0s');
    });
});
