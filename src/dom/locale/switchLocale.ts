import type { BuildError } from '../../core/errors/index.js';
import { unknownLanguage } from '../../core/locale/index.js';
import { cloneJson } from '../../core/resolve/index.js';
import type { JsonObject } from '../../core/types.js';

const APP_PATH = '$.app';
const LOCALE_PATH = '$.locale';

/** The part of a store that switching language needs */
export interface LocaleStore {
    apply: (path: string, source: unknown) => void;
    set: (path: string, value: unknown) => boolean;
}

/**
 * Switches the application to a language: applies its overlay to `$.app` and sets `$.locale`. `overlays` holds one
 * overlay per language code, including the base language (`MountedApp.baseOverlay` under `MountedApp.baseLocale`), so
 * switching back applies the base overlay. A code with no overlay returns a `SUI-LOCALE` error and changes nothing.
 * The overlay is copied, so the store never shares objects with it. `$.data` and `$.theme` are never touched
 */
export function switchLocale(store: LocaleStore, code: string, overlays: Readonly<Record<string, JsonObject>>): BuildError[] {
    if (!Object.hasOwn(overlays, code)) return [unknownLanguage(code)];
    store.apply(APP_PATH, cloneJson(overlays[code] as JsonObject));
    store.set(LOCALE_PATH, code);
    return [];
}
