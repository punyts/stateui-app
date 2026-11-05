import type { Store, WriteOptions } from '@punyts/state';
import { ROUTE_PATH, screenPath } from '../../core/route/index.js';

/** The attribute that names the screen a container holds */
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
    /** The element the app is mounted on: screens go here when the shell has no outlet element */
    host: Element;
    store: AnyStore;
    /** The names of the document's screens */
    screens: readonly string[];
    /** The state path of the shell's `outlet` node and the tag of its component; undefined without one */
    outlet?: { path: string; tag: string };
}

export interface ScreenView {
    /** The screen that shows, undefined before one does */
    visible(): string | undefined;
    dispose(): void;
}

/**
 * Shows the screen `$.route.screen` names. A screen is mounted on its first visit, as a container holding
 * `<sui-node state="$.screens.{name}">` in the shell's outlet element (the host when there is none), and a screen that
 * is left gets `hidden`, so its elements and their articulation (typed values, open panels) stay for the way back.
 * The outlet element is looked up on every change, so a re-rendered outlet gets the containers again
 */
export function startScreens(options: ScreenViewOptions): ScreenView {
    const { host, store } = options;
    const known = new Set(options.screens);
    const containers = new Map<string, HTMLElement>();
    let shown: string | undefined;

    const outletElement = (): Element => (options.outlet ? findElement(host, options.outlet.tag, options.outlet.path) : undefined) ?? host;

    const show = (): void => {
        const screen: unknown = store.get(`${ROUTE_PATH}.screen`);
        const name = typeof screen === 'string' && known.has(screen) ? screen : undefined;
        const parent = outletElement();
        if (name !== undefined && !containers.has(name)) {
            const container = host.ownerDocument.createElement('div');
            container.setAttribute(SCREEN_ATTRIBUTE, name);
            const node = host.ownerDocument.createElement('sui-node');
            node.setAttribute('state', screenPath(name));
            container.appendChild(node);
            containers.set(name, container);
        }
        for (const [key, container] of containers) {
            container.hidden = key !== name;
            if (container.parentNode !== parent) parent.appendChild(container);
        }
        shown = name;
    };

    const listener = (): void => show();
    store.on([ROUTE_PATH, `${ROUTE_PATH}.$all`], listener);
    show();
    return {
        visible: () => shown,
        dispose(): void {
            store.off([ROUTE_PATH, `${ROUTE_PATH}.$all`], listener);
            for (const container of containers.values()) container.remove();
            containers.clear();
            shown = undefined;
        }
    };
}
