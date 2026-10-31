import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTokenFallbacks } from '../../build/tokenFallbacks.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from '../mount/index.js';
import type { MountedApp } from '../mount/index.js';

function shapeOf(file: string, tokens: Record<string, unknown>) {
    const result = parseShape({ summary: 'Fixture', tokens }, file);
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const chip = shapeOf('chip.state.json', { radius: '{radius.md}' });
const tokens = chip.tokens ?? [];

// The build's own transform writes the fallback, so the fixture is styled the way a built component is
defineComponent({
    tag: 'x-token-chip',
    template: '<i>chip</i>',
    styles: applyTokenFallbacks(':host { display: block; border-radius: var(--ui-chip-radius); }', {
        component: 'chip',
        file: 'chip.view.css',
        tokens
    })
});
defineComponent({ tag: 'x-token-plain', template: '<i>plain</i>', styles: ':host { display: block; }' });

const library: ComponentLibrary = { chip: { tier: 'root', tag: 'x-token-chip', shape: chip } };
const documentOf = (theme?: AppDocument['theme']): AppDocument => ({ ...(theme ? { theme } : {}), app: { component: 'chip' } });

function find(root: ParentNode, tag: string): Element | undefined {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate;
        const inner = candidate.shadowRoot ? find(candidate.shadowRoot, tag) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

describe('component tokens on <ui-app-root> in Chromium', () => {
    const apps: MountedApp[] = [];
    let host: HTMLElement;

    function start(doc: AppDocument, using: ComponentLibrary = library): MountedApp {
        const app = mountApp(host, doc, using);
        apps.push(app);
        return app;
    }

    function radius(): string {
        return getComputedStyle(find(host, 'x-token-chip') as Element).borderTopLeftRadius;
    }

    beforeEach(() => {
        vi.spyOn(report, 'error').mockImplementation(() => undefined);
        host = window.document.body.appendChild(window.document.createElement('div'));
    });

    afterEach(() => {
        for (const app of apps.splice(0)) app.dispose();
        vi.restoreAllMocks();
        window.document.body.replaceChildren();
    });

    it('should use the semantic default when the component token is not set', () => {
        // Arrange / Act
        const app = start(documentOf());

        // Assert
        expect(app.errors).toEqual([]);
        expect(radius()).toBe('6px');
        expect(app.store?.get('$.theme.tokens.chip')).toEqual({});
    });

    it('should emit no value for an unset component token, and the property once it is set', () => {
        // Arrange
        const app = start(documentOf());
        const root = host.firstElementChild as HTMLElement;

        // Act / Assert
        expect(Array.from(root.style).some((name) => name.includes('chip-radius'))).toBe(false);
        app.store?.set('$.theme.tokens.chip.radius', '2px');
        expect(getComputedStyle(root).getPropertyValue('--ui-chip-radius').trim()).toBe('2px');
    });

    it('should change the component when the component token is written', () => {
        // Arrange
        const app = start(documentOf());

        // Act
        app.store?.set('$.theme.tokens.chip.radius', '0');

        // Assert
        expect(radius()).toBe('0px');
    });

    it('should restore the default when the leaf is deleted', () => {
        // Arrange
        const app = start(documentOf());
        app.store?.set('$.theme.tokens.chip.radius', '0');

        // Act
        app.store?.delete('$.theme.tokens.chip.radius');

        // Assert
        expect(radius()).toBe('6px');
    });

    it('should follow the semantic token while the component token is unset, so the default is live', () => {
        // Arrange
        const app = start(documentOf());

        // Act
        app.store?.set('$.theme.tokens.radius.md', '14px');

        // Assert
        expect(radius()).toBe('14px');
    });

    it('should start with a component token the document sets and accept it in validation', () => {
        // Arrange / Act
        const app = start(documentOf({ tokens: { chip: { radius: '3px' } } }));

        // Assert
        expect(app.errors).toEqual([]);
        expect(radius()).toBe('3px');
    });

    it('should reject a component token that no shape declares', () => {
        // Arrange / Act
        const app = start(documentOf({ tokens: { ghost: { radius: '3px' } } }));

        // Assert
        expect(app.store).toBeUndefined();
        expect(app.errors.map((error) => error.code)).toContain('SUI-THEME-TOKEN');
    });

    it('should give a library with a different token set its own root tag', () => {
        // Arrange
        const plain = parseShape({ summary: 'Plain' }, 'plain.state.json').shape;
        if (!plain) throw new Error('plain shape');
        const other: ComponentLibrary = { chip: { tier: 'root', tag: 'x-token-plain', shape: plain } };
        const first = host.appendChild(window.document.createElement('div'));
        apps.push(mountApp(first, documentOf(), library));

        // Act
        apps.push(mountApp(host, documentOf(), other));

        // Assert
        expect(first.firstElementChild?.localName).toMatch(/^ui-app-root/);
        expect(host.lastElementChild?.localName).toMatch(/^ui-app-root/);
        expect(host.lastElementChild?.localName).not.toBe(first.firstElementChild?.localName);
    });
});
