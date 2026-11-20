import { report } from '@punyts/core';
import type { Store } from '@punyts/state';
import type { AppDocument } from '../../core/types.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import type { DispatchHooks } from '../on/types.js';
import type { MountedApp, MountOptions } from '../mount/types.js';
import { APP_OPEN_EVENT } from './types.js';
import type { AppHost, AppOpenRequest, EmbeddedApp, OpenedApp } from './types.js';

type Mount = (host: Element, document: AppDocument, library: ComponentLibrary, hooks: DispatchHooks, options: MountOptions) => MountedApp;

const DATA_PATH = '$.data';
/** A navigation replaces `$.route` or writes below it */
const ROUTE_PATHS = ['$.route', '$.route.$all'];

function isOpenRequest(value: unknown): value is AppOpenRequest {
    if (typeof value !== 'object' || value === null) return false;
    const request = value as Partial<AppOpenRequest>;
    return (
        typeof request.app === 'string' &&
        typeof request.live === 'boolean' &&
        request.element instanceof Element &&
        typeof request.respond === 'function' &&
        typeof request.onEmit === 'function' &&
        typeof request.onNavigate === 'function'
    );
}

/** A plain copy of a JSON value read from a store, which hands out live views */
function copy<T>(value: T): T {
    return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * Mounts what the host opened inside the request's element: embedded (no URL, no document title), on its screen, with
 * the followed store's data when it previews another app
 */
function embed(request: AppOpenRequest, opened: OpenedApp, mount: Mount): EmbeddedApp {
    const follows: Store<unknown> | undefined = opened.follows;
    const document: AppDocument = follows === undefined ? opened.document : { ...opened.document, data: copy(follows.get(DATA_PATH)) ?? {} };
    const hooks: DispatchHooks = {
        ...opened.hooks,
        onEmit: (name, payload) => {
            opened.hooks?.onEmit?.(name, payload);
            request.onEmit(name, payload);
        }
    };
    const app = mount(request.element, document, opened.library, hooks, { ...opened.options, route: false, embedded: true });
    const store = app.store;
    if (store === undefined) {
        app.dispose();
        throw new Error(`The app ${request.app} did not mount: ${app.errors.map((error) => error.code).join(', ')}`);
    }
    if (request.screen !== undefined && request.screen !== app.visibleScreen()) app.navigate(request.screen);
    const follow = (path: string, value: unknown, _old: unknown, action: string): void => {
        if (action === 'delete') store.delete(path);
        else store.set(path, copy(value) as never);
    };
    if (follows !== undefined) follows.on(`${DATA_PATH}.$all`, follow as never);
    let shown = app.visibleScreen();
    const moved = (): void => {
        const screen = app.visibleScreen();
        if (screen === undefined || screen === shown) return;
        shown = screen;
        request.onNavigate(screen);
    };
    store.on(ROUTE_PATHS, moved);
    opened.mounted?.(app);
    let disposed = false;
    return {
        navigate: (screen) => {
            const why = app.navigate(screen);
            if (why === undefined) shown = app.visibleScreen();
            return why;
        },
        dispose: () => {
            if (disposed) return;
            disposed = true;
            store.off(ROUTE_PATHS, moved);
            if (follows !== undefined) follows.off(`${DATA_PATH}.$all`, follow as never);
            app.dispose();
            opened.disposed?.(app);
        }
    };
}

/**
 * Answers the `ui-app-open` requests raised below `host` through the page's app host, mounting each app the host opens
 * with `mount` (`mountApp`, passed in so this module does not import it). Returns the listener's disposer
 */
export function answerAppRequests(host: Element, apps: AppHost, mount: Mount): () => void {
    const answer = (event: Event): void => {
        const request: unknown = event instanceof CustomEvent ? event.detail : undefined;
        if (!isOpenRequest(request)) return;
        event.stopPropagation();
        const { app, live } = request;
        const ask = { app, live, ...(request.screen === undefined ? {} : { screen: request.screen }) };
        const result = apps.open(ask).then((opened) => embed(request, opened, mount));
        result.catch((error: unknown) => report.warning('An embedded app was not opened', { app, reason: String(error) }));
        request.respond(result);
    };
    host.addEventListener(APP_OPEN_EVENT, answer);
    return () => host.removeEventListener(APP_OPEN_EVENT, answer);
}
