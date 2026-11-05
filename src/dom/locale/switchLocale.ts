import type { BuildError } from '../../core/errors/index.js';
import { unknownLanguage } from '../../core/locale/index.js';
import { cloneJson } from '../../core/resolve/index.js';
import { screenPath } from '../../core/route/index.js';
import type { JsonObject } from '../../core/types.js';

const APP_PATH = '$.app';
const LOCALE_PATH = '$.locale';

/** The part of a store that switching language needs */
export interface LocaleStore {
    apply: (path: string, source: unknown) => void;
    set: (path: string, value: string) => boolean;
}

/** The overlays of each screen by screen name, then by language code; each is relative to `$.screens.{name}` */
export type ScreenOverlays = Readonly<Record<string, Readonly<Record<string, JsonObject>>>>;

/**
 * Switches the application to a language: applies its overlay to `$.app`, the overlay of each screen in `screens` to
 * that screen's root (`$.screens.{name}`, mounted in the DOM or not), and sets `$.locale`. `overlays` holds one
 * overlay per language code, including the base language (`MountedApp.baseOverlay` under `MountedApp.baseLocale`), so
 * switching back applies the base overlay; `screens` holds the same per screen (`MountedApp.screenBaseOverlays` for
 * the base language). A code that neither `overlays` nor any screen has returns a `SUI-LOCALE` error and changes
 * nothing. The overlays are copied, so the store never shares objects with them. `$.data` and `$.theme` are never
 * touched
 */
export function switchLocale(
    store: LocaleStore,
    code: string,
    overlays: Readonly<Record<string, JsonObject>>,
    screens: ScreenOverlays = {}
): BuildError[] {
    const inScreens = Object.entries(screens).filter(([, byCode]) => Object.hasOwn(byCode, code));
    if (!Object.hasOwn(overlays, code) && inScreens.length === 0) return [unknownLanguage(code)];
    if (Object.hasOwn(overlays, code)) store.apply(APP_PATH, cloneJson(overlays[code] as JsonObject));
    for (const [name, byCode] of inScreens) store.apply(screenPath(name), cloneJson(byCode[code] as JsonObject));
    store.set(LOCALE_PATH, code);
    return [];
}
