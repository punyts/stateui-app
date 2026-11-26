import type { AppIcon } from './icons/appIcons.js';
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

/** One screen of an assembled app: a root node the app node lays out; its `placement` places it in the app's `layout` */
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
    /** The app node (`app` component) when the app has screens; otherwise the one tree of the app */
    app: Node;
    /** The screens of an app assembled from a blueprint; each root node's state path is `$.screens.{screen}` */
    screens?: Record<string, DocumentScreen>;
    /** The screen `$.route` starts on; required with `screens` */
    start?: string;
    composed?: Record<string, Node>;
    locales?: Record<string, JsonObject>;
    /** Machines and rules (`logic/types.ts`); document only, never in a snapshot */
    logic?: JsonObject;
    /** The app's own icons by name (`icons/appIcons.ts`); a name here wins over the icon set's */
    icons?: Record<string, AppIcon>;
    /** State paths whose changes reach everyone using the app but are never stored (a pointer, presence); `*` matches one segment */
    ephemeral?: string[];
    /** The paths the nodes mark `@local` (`meta/metadataPaths.ts`), written by assembly: they stay on the device */
    local?: string[];
    /** The paths the nodes mark `@secret`, written by assembly: they go to server logic only, never stored or relayed */
    secret?: string[];
    /** Alias to another app's state path, or another owner's shared dataset, it mirrors at `$.external.{alias}` (`uses.external`), read only */
    external?: Record<string, { app: string; path: string } | { owner: string; dataset: string }>;
}

/** The top-level keys of a document */
/** The app events the host raises, which the root node's (`$.app`) `on` entries may use */
export const APP_EVENTS = ['sync.rejected', 'sync.requested', 'logic.failed'] as const;

/** An app event: one of `APP_EVENTS`, or `notify.<name>` raised by the logic's `notify` command */
export type AppEventName = (typeof APP_EVENTS)[number] | `notify.${string}`;

/**
 * The messages an app's toasts (`$.app.toasts`, a `toastRegion`) show by themselves when the root node has no entry
 * for the app event: for `sync.rejected`, `unsaved` for a change refused while the server holds too many unsaved
 * changes (rejection code `unsaved`) and `rejected` for any other refused change; for `sync.requested`, `requested` for
 * a change kept as a request for the owner to decide (docs/design/statenet-requests.md). A `toastRegion` whose
 * `messages` has the same key shows that instead
 */
export const SYNC_NOTICES = { unsaved: 'syncUnsaved', rejected: 'syncRejected', requested: 'syncRequested' } as const;

/** `notify.<name>`: the app events the logic's `notify` command raises */
const NOTIFY_EVENT = /^notify.[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** True for a name in `APP_EVENTS` or a `notify.<name>` event */
export function isAppEvent(name: unknown): name is string {
    return typeof name === 'string' && ((APP_EVENTS as readonly string[]).includes(name) || NOTIFY_EVENT.test(name));
}

export const DOCUMENT_KEYS = ['theme', 'themes', 'appThemes', 'locale', 'data', 'app', 'screens', 'start', 'composed', 'locales', 'logic', 'icons', 'ephemeral', 'local', 'secret', 'external'] as const;

/** The node keys that are not component state */
export const RESERVED_KEYS = {
    component: 'component',
    children: 'children',
    layout: 'layout',
    placement: 'placement',
    theme: 'theme',
    on: 'on'
} as const;

/** Property name prefixes: content, links, metadata, and `__` kept for future instructions (an error today) */
export const PREFIXES = {
    content: '_',
    link: '<-',
    meta: '@',
    reserved: '__'
} as const;

/**
 * The metadata keys a node of a definition may carry (docs/design/state-definitions-and-instances.md): `@id` names
 * the node for `#name` references; `@local`, `@secret` and `@transient` mark the node's own properties (`true` for
 * all of them, or a list of names) whose changes stay on the device, reach only the server's logic, or are synced but
 * never stored. Metadata is read from the definition only: an instance never sets it, and it is never state
 */
export const META_KEYS = {
    id: '@id',
    local: '@local',
    secret: '@secret',
    transient: '@transient'
} as const;

/** The metadata key names as a list */
export const META_KEY_NAMES: readonly string[] = Object.values(META_KEYS);

/** The reserved key names as a list */
export const RESERVED_KEY_NAMES: readonly string[] = Object.values(RESERVED_KEYS);
