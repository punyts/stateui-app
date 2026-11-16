import type { Store, WriteOptions } from '@punyts/state';
import { ROUTE_PATH, screenPath } from '../../core/route/index.js';

/** The state path of the app node */
const APP_PATH = '$.app';

/** The attribute that names the screen a `<sui-node>` shows */
export const SCREEN_ATTRIBUTE = 'data-sui-screen';

type AnyStore = Pick<Store<unknown>, 'get' | 'set' | 'delete' | 'on' | 'off' | 'protect' | 'unprotect'>;

/** True when `path` is `$.route` or below it */
export function isRoutePath(path: string): boolean {
    return path === ROUTE_PATH || path.startsWith(`${ROUTE_PATH}.`);
}

/**
 * Writes (or, for an undefined `value`, deletes) `path` while `$.route` is lifted out of its protection: the route
 * changes only through `navigate`, and `navigate` is the one caller. False when the store refused the write
 */
export function writeRoute(store: AnyStore, path: string, value: unknown, options?: WriteOptions): boolean {
    const was = store.unprotect(ROUTE_PATH);
    try {
        return value === undefined ? store.delete(path, options) : store.set(path, value as never, options);
    } finally {
        if (was) store.protect(ROUTE_PATH);
    }
}

/** The first element below `root` (crossing open shadow roots) with the tag whose scope is at `path` */
function findElement(root: ParentNode, tag: string, path: string): Element | undefined {
    for (const element of Array.from(root.querySelectorAll(tag))) {
        if ((element as { scope?: { basePath?: unknown } }).scope?.basePath === path) return element;
    }
    for (const element of Array.from(root.querySelectorAll('*'))) {
        const inner = element.shadowRoot ? findElement(element.shadowRoot, tag, path) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

export interface ScreenViewOptions {
    /** The element the app is mounted on: screens go here when there is no app element to lay them out */
    host: Element;
    store: AnyStore;
    /** The names of the document's screens */
    screens: readonly string[];
    /** The tag of the `app` component, whose element at `$.app` lays out the screens; undefined when the library has none */
    appTag?: string;
}

export interface ScreenView {
    /** The screen that shows, undefined before one does */
    visible(): string | undefined;
    /** The `<sui-node>` of each screen mounted so far, by name */
    elements(): ReadonlyMap<string, HTMLElement>;
    dispose(): void;
}

/** Shows or hides a screen's `<sui-node>`: it is `display: contents` while shown, so its child is the layout item */
function setShown(element: HTMLElement, shown: boolean): void {
    element.hidden = !shown;
    element.style.display = shown ? 'contents' : 'none';
}

/** Moves focus to a screen that was switched to, so keyboard and screen-reader users start at its content */
function focusScreen(element: HTMLElement): void {
    const target = element.firstElementChild as HTMLElement | null;
    if (target === null) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
}

/**
 * Shows the screen `$.route.screen` names. A screen is mounted on its first visit, as a
 * `<sui-node state="$.screens.{name}" data-sui-screen="{name}">` directly in the layout host of the `app` element (the
 * host when there is none), so the app's `layout` places it by the screen root's `placement`. A screen that is left
 * gets `hidden`, so its elements and their articulation (typed values, open panels) stay for the way back. The app
 * element is looked up on every change, so a re-rendered app gets the screens again. Switching to another screen moves
 * focus to it; the first screen does not take focus
 */
export function startScreens(options: ScreenViewOptions): ScreenView {
    const { host, store } = options;
    const known = new Set(options.screens);
    const elements = new Map<string, HTMLElement>();
    let shown: string | undefined;

    const parentElement = (): Element => {
        const app = options.appTag === undefined ? undefined : findElement(host, options.appTag, APP_PATH);
        return app?.shadowRoot?.querySelector('[layout-host]') ?? app ?? host;
    };

    const show = (): void => {
        const screen: unknown = store.get(`${ROUTE_PATH}.screen`);
        const name = typeof screen === 'string' && known.has(screen) ? screen : undefined;
        const parent = parentElement();
        if (name !== undefined && !elements.has(name)) {
            const node = host.ownerDocument.createElement('sui-node');
            node.setAttribute(SCREEN_ATTRIBUTE, name);
            node.setAttribute('state', screenPath(name));
            elements.set(name, node);
        }
        for (const element of elements.values()) {
            if (element.parentNode !== parent) parent.appendChild(element);
        }
        // After appending: connecting a `<sui-node>` sets its display
        for (const [key, element] of elements) setShown(element, key === name);
        const switched = shown !== undefined && name !== undefined && name !== shown;
        shown = name;
        if (switched) focusScreen(elements.get(name) as HTMLElement);
    };

    const listener = (): void => show();
    store.on([ROUTE_PATH, `${ROUTE_PATH}.$all`], listener);
    show();
    return {
        visible: () => shown,
        elements: () => elements,
        dispose(): void {
            store.off([ROUTE_PATH, `${ROUTE_PATH}.$all`], listener);
            for (const element of elements.values()) element.remove();
            elements.clear();
            shown = undefined;
        }
    };
}
