import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildError } from '../../core/errors/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { AppInstance } from '../../core/snapshot/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from '../mount/index.js';
import type { MountedApp } from '../mount/index.js';

const shape = parseShape({ summary: 'Fixture', properties: {}, events: [] }, 'fixture.state.json').shape;
if (!shape) throw new Error('fixture shape');

defineComponent({
    tag: 'x-th-swatch',
    template: '<i>swatch</i>',
    styles: ':host { display: block; color: var(--ui-color-accent-base); background: var(--ui-color-surface-base); }'
});

const library: ComponentLibrary = { swatch: { tier: 'root', tag: 'x-th-swatch', shape } };

const SEA = { tokens: { color: { accent: { base: '#0050a0' } } }, overlays: { night: { kind: 'mode', tokens: { color: { surface: { base: '#101820' } } } } } };
const SAND = { tokens: { color: { accent: { base: '#a05000' } } }, overlays: { night: { kind: 'mode', tokens: { color: { surface: { base: '#302010' } } } } } };

/** An app assembled from two themes: \`theme\` and \`themes\` are the first's, \`appThemes\` carries both */
const DOCUMENT = {
    app: { component: 'swatch' },
    theme: { tokens: SEA.tokens },
    themes: SEA.overlays,
    appThemes: { sea: SEA, sand: SAND }
} as unknown as AppDocument;

/** A colour as the browser computes it */
function computed(value: string): string {
    const probe = window.document.body.appendChild(window.document.createElement('span'));
    probe.style.color = value;
    const result = getComputedStyle(probe).color;
    probe.remove();
    return result;
}

function swatch(host: ParentNode): HTMLElement {
    for (const candidate of Array.from(host.querySelectorAll('*'))) {
        if (candidate.localName === 'x-th-swatch') return candidate as HTMLElement;
        if (candidate.shadowRoot) {
            const inner = candidate.shadowRoot.querySelector('x-th-swatch');
            if (inner) return inner as HTMLElement;
        }
    }
    throw new Error('no swatch');
}

describe('theme switching in Chromium', () => {
    const apps: MountedApp[] = [];
    let host: HTMLElement;
    let errors: BuildError[];

    function start(instance?: AppInstance): MountedApp {
        const app = mountApp(host, JSON.parse(JSON.stringify(DOCUMENT)) as AppDocument, library, { onError: (error) => errors.push(error) }, {
            ...(instance === undefined ? {} : { instance })
        });
        apps.push(app);
        return app;
    }

    beforeEach(() => {
        vi.spyOn(report, 'error').mockImplementation(() => undefined);
        host = window.document.body.appendChild(window.document.createElement('div'));
        errors = [];
    });

    afterEach(() => {
        for (const app of apps.splice(0)) app.dispose();
        vi.restoreAllMocks();
        window.document.body.replaceChildren();
    });

    it('should start on the first theme and change a token computed colour after a switch', () => {
        // Arrange
        const app = start();
        const before = getComputedStyle(swatch(host)).color;

        // Act
        app.store?.set('$.theme.active.theme' as never, 'sand' as never);

        // Assert
        expect(before).toBe(computed('#0050a0'));
        expect(app.store?.get('$.theme.active.theme')).toBe('sand');
        expect(getComputedStyle(swatch(host)).color).toBe(computed('#a05000'));
        expect(errors).toEqual([]);
    });

    it('should apply the dark overlay of the new theme when the mode is dark', () => {
        // Arrange
        const app = start();
        app.store?.set('$.theme.active.mode' as never, 'night' as never);
        const seaNight = getComputedStyle(swatch(host)).backgroundColor;

        // Act
        app.store?.set('$.theme.active.theme' as never, 'sand' as never);

        // Assert
        expect(seaNight).toBe(computed('#101820'));
        expect(app.store?.get('$.theme.active.mode')).toBe('night');
        expect(getComputedStyle(swatch(host)).backgroundColor).toBe(computed('#302010'));
        expect(getComputedStyle(swatch(host)).color).toBe(computed('#a05000'));
    });

    it('should refuse a theme the app does not list and keep the active one', () => {
        // Arrange
        const app = start();

        // Act
        app.store?.set('$.theme.active.theme' as never, 'forest' as never);

        // Assert
        expect(app.store?.get('$.theme.active.theme')).toBe('sea');
        expect(getComputedStyle(swatch(host)).color).toBe(computed('#0050a0'));
        expect(errors.map((error) => error.message)).toEqual([
            'Property "theme" at $.theme.active.theme does not fit the shape of "the app\'s themes (sea, sand)"'
        ]);
    });

    it('should mount an instance with the second theme showing it', () => {
        // Act
        const app = start({ app: {}, screens: {}, theme: { active: { theme: 'sand', mode: 'night' } } });

        // Assert
        expect(app.errors.filter((error) => error.code !== 'SUI-THEME-CONTRAST')).toEqual([]);
        expect(app.store?.get('$.theme.active.theme')).toBe('sand');
        expect(getComputedStyle(swatch(host)).color).toBe(computed('#a05000'));
        expect(getComputedStyle(swatch(host)).backgroundColor).toBe(computed('#302010'));
    });
});
