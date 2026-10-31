import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildError } from '../../core/errors/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import { buildOverlayCatalog } from '../../core/theme/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from '../mount/index.js';
import type { MountedApp } from '../mount/index.js';
import { applyOverlay } from './applyOverlay.js';
import type { MediaQueryLike, SystemHooks } from './system.js';

const shape = parseShape({ summary: 'Fixture', properties: {}, events: [] }, 'fixture.state.json').shape;
if (!shape) throw new Error('fixture shape');

defineComponent({ tag: 'x-ov-one', template: '<x-ov-two></x-ov-two>', styles: ':host { display: block; }' });
defineComponent({ tag: 'x-ov-two', template: '<x-ov-three></x-ov-three>', styles: ':host { display: block; }' });
defineComponent({
    tag: 'x-ov-three',
    template: '<i>deep</i>',
    styles:
        ':host { display: block; color: var(--ui-color-accent-base); background: var(--ui-color-surface-base);' +
        ' transition-property: transform; transition-duration: var(--ui-motion-duration-base); }'
});

const library: ComponentLibrary = { deep: { tier: 'root', tag: 'x-ov-one', shape } };
const DARK = '(prefers-color-scheme: dark)';
const REDUCED = '(prefers-reduced-motion: reduce)';

interface FakeMedia {
    hooks: SystemHooks;
    set(query: string, matches: boolean): void;
    listeners(): number;
}

/** A media query source the test flips; each flip fires the registered change listeners */
function fakeMedia(initial: Record<string, boolean> = {}): FakeMedia {
    const matches = new Map<string, boolean>(Object.entries(initial));
    const registered = new Map<string, Set<() => void>>();
    const listOf = (query: string): MediaQueryLike => ({
        get matches() {
            return matches.get(query) ?? false;
        },
        addEventListener: (_type, listener) => {
            registered.set(query, (registered.get(query) ?? new Set()).add(listener));
        },
        removeEventListener: (_type, listener) => {
            registered.get(query)?.delete(listener);
        }
    });
    return {
        hooks: { matchMedia: listOf },
        set(query, value) {
            matches.set(query, value);
            for (const listener of [...(registered.get(query) ?? [])]) listener();
        },
        listeners: () => [...registered.values()].reduce((sum, set) => sum + set.size, 0)
    };
}

function deepest(host: ParentNode): HTMLElement | undefined {
    for (const candidate of Array.from(host.querySelectorAll('*'))) {
        if (candidate.localName === 'x-ov-three') return candidate as HTMLElement;
        const inner = candidate.shadowRoot ? deepest(candidate.shadowRoot) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

/** A colour as the browser computes it */
function computed(value: string): string {
    const probe = window.document.body.appendChild(window.document.createElement('span'));
    probe.style.color = value;
    const result = getComputedStyle(probe).color;
    probe.remove();
    return result;
}

const snapshot = (app: MountedApp): unknown => JSON.parse(JSON.stringify(app.store?.get('$.theme.tokens')));

describe('theme overlays in Chromium', () => {
    const apps: MountedApp[] = [];
    let host: HTMLElement;

    function start(theme?: AppDocument['theme'], extra: Partial<AppDocument> = {}, hooks: SystemHooks & { onError?(error: BuildError): void } = {}): MountedApp {
        const doc: AppDocument = { ...(theme ? { theme } : {}), ...extra, app: { component: 'deep' } };
        const app = mountApp(host, doc, library, hooks);
        apps.push(app);
        return app;
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

    describe('applyOverlay', () => {
        it('should change a surface under the host and in a component three shadow roots deep, and return on light', () => {
            // Arrange
            const app = start();
            const overlays = buildOverlayCatalog(undefined).overlays;
            const target = deepest(host) as HTMLElement;
            const root = host.querySelector('ui-app-root') as HTMLElement;
            const lightState = snapshot(app);
            const lightBackground = getComputedStyle(target).backgroundColor;

            // Act
            applyOverlay(app.store!, 'mode', 'dark', overlays);
            const darkBackground = getComputedStyle(target).backgroundColor;
            const darkRoot = getComputedStyle(root).getPropertyValue('--ui-color-surface-base').trim();
            applyOverlay(app.store!, 'mode', 'light', overlays);

            // Assert
            expect(lightBackground).toBe(computed('#ffffff'));
            expect(darkBackground).toBe(computed('#09090b'));
            expect(darkRoot).toBe('#09090b');
            expect(getComputedStyle(target).backgroundColor).toBe(lightBackground);
            expect(snapshot(app)).toEqual(lightState);
            expect(app.store?.get('$.theme.active.mode')).toBe('light');
        });

        it('should change a primitive and every role that references it with a brand overlay', () => {
            // Arrange
            const doc = { acme: { kind: 'brand', tokens: { palette: { blue: { '600': '#ff0000' } } } } };
            const app = start(undefined, { themes: doc });
            const overlays = buildOverlayCatalog(doc).overlays;
            const target = deepest(host) as HTMLElement;

            // Act
            const errors = applyOverlay(app.store!, 'brand', 'acme', overlays);

            // Assert
            expect(errors).toEqual([]);
            expect(app.store?.get('$.theme.tokens.palette.blue.600')).toBe('#ff0000');
            expect(getComputedStyle(target).color).toBe(computed('#ff0000'));

            applyOverlay(app.store!, 'brand', 'default', overlays);
            expect(getComputedStyle(target).color).toBe(computed('#2563eb'));
        });

        it('should make every motion duration 0 with reduced and restore them with full', () => {
            // Arrange
            const app = start();
            const overlays = buildOverlayCatalog(undefined).overlays;
            const target = deepest(host) as HTMLElement;

            // Act
            applyOverlay(app.store!, 'motion', 'reduced', overlays);
            const reduced = ['fast', 'base', 'slow'].map((name) => app.store?.get(`$.theme.tokens.motion.duration.${name}`));
            const transition = getComputedStyle(target).transitionDuration;
            applyOverlay(app.store!, 'motion', 'full', overlays);

            // Assert
            expect(reduced.map((value) => parseFloat(value))).toEqual([0, 0, 0]);
            expect(transition).toBe('0s');
            expect(getComputedStyle(target).transitionDuration).toBe('0.2s');
        });

        it('should change nothing for an unknown name', () => {
            // Arrange
            const app = start();
            const before = snapshot(app);

            // Act
            const errors = applyOverlay(app.store!, 'mode', 'sepia', buildOverlayCatalog(undefined).overlays);

            // Assert
            expect(errors.map((error) => error.code)).toEqual(['SUI-THEME-OVERLAY']);
            expect(snapshot(app)).toEqual(before);
            expect(app.store?.get('$.theme.active.mode')).toBe('light');
        });
    });

    describe('mountApp', () => {
        it('should apply the active overlay of each kind at start with the document tokens on top', () => {
            // Arrange / Act
            const app = start({ active: { mode: 'dark', motion: 'reduced' }, tokens: { color: { accent: { base: '#ff0000' } } } });
            const target = deepest(host) as HTMLElement;

            // Assert
            expect(app.errors).toEqual([]);
            expect(getComputedStyle(target).backgroundColor).toBe(computed('#09090b'));
            expect(getComputedStyle(target).color).toBe(computed('#ff0000'));
            expect(getComputedStyle(target).transitionDuration).toBe('0s');
        });

        it('should apply a document overlay named in theme.active', () => {
            // Arrange / Act
            const app = start({ active: { brand: 'acme' } }, { themes: { acme: { kind: 'brand', tokens: { radius: { sm: '1px' } } } } });

            // Assert
            expect(app.errors).toEqual([]);
            expect(app.store?.get('$.theme.tokens.radius.sm')).toBe('1px');
        });

        it('should reject a mode overlay with a palette value before render', () => {
            // Arrange / Act
            const app = start(undefined, { themes: { bad: { kind: 'mode', tokens: { palette: { white: '#eeeeee' } } } } });

            // Assert
            expect(app.store).toBeUndefined();
            expect(app.errors.map((error) => error.code)).toEqual(['SUI-THEME-OVERLAY']);
            expect(host.querySelector('ui-app-root')).toBeNull();
        });

        it('should reject a themes name that clashes with a shipped overlay and an active name that does not exist', () => {
            // Arrange / Act
            const clash = start(undefined, { themes: { dark: { kind: 'mode', tokens: {} } } });
            const unknown = start({ active: { mode: 'sepia' } });

            // Assert
            expect(clash.errors.map((error) => error.code)).toEqual(['SUI-THEME-OVERLAY']);
            expect(unknown.errors.map((error) => error.code)).toEqual(['SUI-THEME-OVERLAY']);
        });

        it('should apply the overlay when active.mode is set directly, and report an unknown name', () => {
            // Arrange
            const onError = vi.fn();
            const app = start(undefined, {}, { onError });
            const target = deepest(host) as HTMLElement;

            // Act
            app.store?.set('$.theme.active.mode', 'dark');
            const dark = getComputedStyle(target).backgroundColor;
            app.store?.set('$.theme.active.mode', 'sepia');

            // Assert
            expect(dark).toBe(computed('#09090b'));
            expect(onError).toHaveBeenCalledTimes(1);
            expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: 'SUI-THEME-OVERLAY' });
            expect(getComputedStyle(target).backgroundColor).toBe(dark);
        });
    });

    describe('system mode and motion', () => {
        it('should start dark, follow a change to light and keep the active name system', () => {
            // Arrange
            const media = fakeMedia({ [DARK]: true });
            const app = start({ active: { mode: 'system' } }, {}, media.hooks);
            const target = deepest(host) as HTMLElement;
            const first = getComputedStyle(target).backgroundColor;

            // Act
            media.set(DARK, false);

            // Assert
            expect(first).toBe(computed('#09090b'));
            expect(getComputedStyle(target).backgroundColor).toBe(computed('#ffffff'));
            expect(app.store?.get('$.theme.active.mode')).toBe('system');
        });

        it('should stop following when mode is set to an explicit name and resume when set back to system', () => {
            // Arrange
            const media = fakeMedia();
            const app = start({ active: { mode: 'system' } }, {}, media.hooks);
            const target = deepest(host) as HTMLElement;

            // Act
            app.store?.set('$.theme.active.mode', 'contrast');
            media.set(DARK, true);
            const explicit = getComputedStyle(target).backgroundColor;
            const explicitText = app.store?.get('$.theme.tokens.color.text.base');
            app.store?.set('$.theme.active.mode', 'system');
            const resumed = getComputedStyle(target).backgroundColor;
            media.set(DARK, false);

            // Assert
            expect(explicit).toBe(computed('#ffffff'));
            expect(explicitText).toBe('{palette.black}');
            expect(resumed).toBe(computed('#09090b'));
            expect(getComputedStyle(target).backgroundColor).toBe(computed('#ffffff'));
        });

        it('should never select contrast from the system', () => {
            // Arrange
            const media = fakeMedia({ [DARK]: true });

            // Act
            const app = start({ active: { mode: 'system' } }, {}, media.hooks);

            // Assert
            expect(app.store?.get('$.theme.tokens.color.border.base')).toBe('{palette.neutral.800}');
        });

        it('should follow prefers-reduced-motion on and off', () => {
            // Arrange
            const media = fakeMedia();
            const app = start({ active: { motion: 'system' } }, {}, media.hooks);
            const target = deepest(host) as HTMLElement;
            const full = getComputedStyle(target).transitionDuration;

            // Act
            media.set(REDUCED, true);
            const reduced = getComputedStyle(target).transitionDuration;
            media.set(REDUCED, false);

            // Assert
            expect(full).toBe('0.2s');
            expect(reduced).toBe('0s');
            expect(getComputedStyle(target).transitionDuration).toBe('0.2s');
            expect(app.store?.get('$.theme.active.motion')).toBe('system');
        });

        it('should remove the media query listeners on dispose', () => {
            // Arrange
            const media = fakeMedia({ [DARK]: true });
            const app = start({ active: { mode: 'system' } }, {}, media.hooks);
            const registered = media.listeners();

            // Act
            app.dispose();

            // Assert
            expect(registered).toBe(2);
            expect(media.listeners()).toBe(0);
        });
    });
});
