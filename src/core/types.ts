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

/** The theme part of a document: token values and the active overlay name per kind */
export interface ThemeState {
    tokens?: JsonObject;
    active?: Record<string, string>;
}

/** An application is one document */
export interface AppDocument {
    theme?: ThemeState;
    themes?: Record<string, ThemeOverlay>;
    locale?: string;
    data?: JsonObject;
    app: Node;
    composed?: Record<string, Node>;
    locales?: Record<string, JsonObject>;
}

/** The top-level keys of a document */
export const DOCUMENT_KEYS = ['theme', 'themes', 'locale', 'data', 'app', 'composed', 'locales'] as const;

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
