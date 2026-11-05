/** Any JSON value */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** A node: an object with a `component` key; its other properties are its state */
export interface Node {
    component: string;
    [key: string]: JsonValue;
}

/** A custom theme overlay: the token groups it sets and the kind that says which groups it may touch */
export interface ThemeOverlay {
    kind: string;
    tokens: JsonObject;
}

/** One theme of an app with several: its base tokens and its overlays by name */
export interface AppTheme {
    tokens: JsonObject;
    overlays?: Record<string, ThemeOverlay>;
}

/** The theme part of a document: token values and the active overlay name per kind */
export interface ThemeState {
    tokens?: JsonObject;
    active?: Record<string, string>;
}

/** One screen of an assembled app: shown in the shell's `outlet` */
export interface DocumentScreen {
    title?: string;
    /** Typed param declarations by name */
    params?: JsonObject;
    root: Node;
    /** Overlays of the screen's content by language code, relative to the screen's root (`$.screens.{name}`) */
    locales?: Record<string, JsonObject>;
}

/** An application is one document */
export interface AppDocument {
    theme?: ThemeState;
    themes?: Record<string, ThemeOverlay>;
    /**
     * Every theme an assembled app offers, by name, in the order of `uses.themes`; `$.theme.active.theme` picks one at
     * run time. `theme.tokens` and `themes` stay the first theme's
     */
    appThemes?: Record<string, AppTheme>;
    locale?: string;
    data?: JsonObject;
    /** The shell when the app has screens */
    app: Node;
    /** The screens of an app assembled from a blueprint; each root node's state path is `$.screens.{screen}` */
    screens?: Record<string, DocumentScreen>;
    /** The screen `$.route` starts on; required with `screens` */
    start?: string;
    composed?: Record<string, Node>;
    locales?: Record<string, JsonObject>;
    /** Machines and rules (`logic/types.ts`); document only, never in a snapshot */
    logic?: JsonObject;
}

/** The top-level keys of a document */
/** The app events the host raises, which the root node's (`$.app`) `on` entries may use */
export const APP_EVENTS = ['sync.rejected', 'logic.failed'] as const;

/** An app event: one of `APP_EVENTS`, or `notify.<name>` raised by the logic's `notify` command */
export type AppEventName = (typeof APP_EVENTS)[number] | `notify.${string}`;

/** `notify.<name>`: the app events the logic's `notify` command raises */
const NOTIFY_EVENT = /^notify.[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** True for a name in `APP_EVENTS` or a `notify.<name>` event */
export function isAppEvent(name: unknown): name is string {
    return typeof name === 'string' && ((APP_EVENTS as readonly string[]).includes(name) || NOTIFY_EVENT.test(name));
}

export const DOCUMENT_KEYS = ['theme', 'themes', 'appThemes', 'locale', 'data', 'app', 'screens', 'start', 'composed', 'locales', 'logic'] as const;

/** The node keys that are not component state */
export const RESERVED_KEYS = {
    component: 'component',
    children: 'children',
    layout: 'layout',
    placement: 'placement',
    theme: 'theme',
    on: 'on'
} as const;

/** Property name prefixes: content, links, and `__` kept for future instructions (an error today) */
export const PREFIXES = {
    content: '_',
    link: '<-',
    reserved: '__'
} as const;

/** The reserved key names as a list */
export const RESERVED_KEY_NAMES: readonly string[] = Object.values(RESERVED_KEYS);
