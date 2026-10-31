import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { followSystem, resolveSystem, systemMode, systemMotion } from './system.js';
import type { MediaQueryLike, SystemHooks } from './system.js';

interface FakeMedia {
    hooks: SystemHooks;
    set(query: string, matches: boolean): void;
    listeners(query: string): number;
}

/** A matchMedia whose queries the test flips; each flip fires the registered change listeners */
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
        listeners: (query) => registered.get(query)?.size ?? 0
    };
}

const DARK = '(prefers-color-scheme: dark)';
const REDUCED = '(prefers-reduced-motion: reduce)';

function sourceFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.ts$/.test(path) && !/\.test\.ts$/.test(path) ? [path] : [];
    });
}

describe('system', () => {
    it('should ask for dark and reduced only when the media queries match', () => {
        // Arrange
        const media = fakeMedia({ [DARK]: true });

        // Act
        const first = [systemMode(media.hooks), systemMotion(media.hooks)];
        media.set(DARK, false);
        media.set(REDUCED, true);

        // Assert
        expect(first).toEqual(['dark', 'full']);
        expect([systemMode(media.hooks), systemMotion(media.hooks)]).toEqual(['light', 'reduced']);
    });

    it('should resolve system in mode and motion and leave other names alone', () => {
        // Arrange
        const media = fakeMedia({ [DARK]: true, [REDUCED]: true });

        // Act
        const resolved = resolveSystem({ mode: 'system', brand: 'acme', motion: 'system' }, media.hooks);
        const explicit = resolveSystem({ mode: 'contrast', motion: 'full' }, media.hooks);

        // Assert
        expect(resolved).toEqual({ mode: 'dark', brand: 'acme', motion: 'reduced' });
        expect(explicit).toEqual({ mode: 'contrast', motion: 'full' });
    });

    it('should call back with the kind that changed and stop after the dispose function runs', () => {
        // Arrange
        const media = fakeMedia();
        const changed = vi.fn();
        const stop = followSystem(media.hooks, changed);

        // Act
        media.set(DARK, true);
        media.set(REDUCED, true);
        stop();
        media.set(DARK, false);

        // Assert
        expect(changed.mock.calls).toEqual([['mode'], ['motion']]);
        expect(media.listeners(DARK)).toBe(0);
        expect(media.listeners(REDUCED)).toBe(0);
    });

    it('should read the environment in this module only', () => {
        // Arrange
        const root = join(__dirname, '..', '..');
        const offenders = sourceFiles(root).filter(
            (path) => !path.endsWith(join('theme', 'system.ts')) && readFileSync(path, 'utf8').includes('matchMedia')
        );

        // Assert
        expect(offenders).toEqual([]);
    });
});
