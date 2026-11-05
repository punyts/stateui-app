import { report } from '@punyts/core';
import { ROUTE_PATH, formatFragment, initialRoute, isRouteRefusal, parseFragment, routeTo, sameRoute } from '../../core/route/index.js';
import type { RouteScreens, RouteState } from '../../core/route/index.js';
import type { JsonValue } from '../../core/types.js';
import { writeRoute } from '../mount/screens.js';
import { registerMountStep } from '../mount/steps.js';
import type { StartedContext } from '../mount/types.js';

/** The name of the route step */
export const ROUTE_STEP = 'route';

/**
 * The DOM event a component raises to show a screen (`link` and `nav` items with a `screen`): bubbling and composed,
 * with `detail: { screen, params? }`. The app that holds the element navigates as the `navigate` command does and stops
 * the event, so an app nested in another handles its own. A refusal is reported as a warning and changes nothing
 */
export const NAVIGATE_EVENT = 'sui-navigate';

/** What a `sui-navigate` event carries */
export interface NavigateRequest {
    screen: string;
    params?: JsonValue;
}

const WATCHED = [ROUTE_PATH, `${ROUTE_PATH}.$all`];

type RouteStore = StartedContext['store'];

function currentRoute(store: RouteStore): RouteState | undefined {
    return store.get(ROUTE_PATH as never) as RouteState | undefined;
}

/** The URL with `fragment` as its hash; an empty fragment removes the hash */
function withFragment(location: Location, fragment: string): string {
    return `${location.pathname}${location.search}${fragment}`;
}

/**
 * Keeps `$.route` and the URL fragment (`#/product?id=p42`) of the window in step: on start a fragment that names a
 * screen the app can show replaces the start route, a navigation pushes a history entry, and the back and forward
 * buttons (`popstate`) and a hash typed by hand (`hashchange`) navigate. A fragment that names no screen, an unknown
 * one or params that do not fit goes to the `start` screen and is replaced by its fragment. On dispose a fragment the
 * step wrote is removed from the URL. Off with `MountOptions.route: false`
 */
function followFragment(context: StartedContext, screens: RouteScreens, view: Window): () => void {
    const { store } = context;
    const { history, location } = view;
    const start = initialRoute(context.document);
    let written = '';
    let fromUrl = false;

    const show = (fragment: string, replace: boolean): void => {
        if (location.hash === fragment) {
            written = fragment;
            return;
        }
        if (replace) history.replaceState(history.state, '', withFragment(location, fragment));
        else history.pushState(null, '', withFragment(location, fragment));
        written = fragment;
    };

    const sync = (): void => {
        const route = currentRoute(store);
        if (route !== undefined) show(formatFragment(route, screens), fromUrl);
    };

    // Writing the whole route notifies each changed leaf before `$.route` itself, so a leaf sees a half-written route
    // (the new screen with the old params): the whole route syncs at once, a lone leaf write a microtask later
    let pending = false;
    const onRoute = (path?: unknown): void => {
        if (path === undefined || path === ROUTE_PATH) {
            sync();
            return;
        }
        if (pending) return;
        pending = true;
        queueMicrotask(() => {
            pending = false;
            if (!stopped) sync();
        });
    };
    let stopped = false;

    const onUrl = (): void => {
        const parsed = parseFragment(location.hash, screens);
        const target = parsed === undefined || isRouteRefusal(parsed) ? start : parsed;
        if (parsed !== undefined && isRouteRefusal(parsed)) report.warning('The URL names a screen the app cannot show', { reason: parsed.reason });
        if (target === undefined) return;
        fromUrl = true;
        try {
            if (!sameRoute(currentRoute(store), target)) writeRoute(store as never, ROUTE_PATH, target);
            sync();
        } finally {
            fromUrl = false;
        }
    };

    store.on(WATCHED as never, onRoute);
    view.addEventListener('popstate', onUrl);
    view.addEventListener('hashchange', onUrl);
    fromUrl = true;
    sync();
    fromUrl = false;
    return () => {
        stopped = true;
        store.off(WATCHED as never, onRoute);
        view.removeEventListener('popstate', onUrl);
        view.removeEventListener('hashchange', onUrl);
        if (written !== '' && location.hash === written) history.replaceState(history.state, '', withFragment(location, ''));
    };
}

/**
 * The route step: for an app with screens it reads the URL fragment before the store exists (a fragment naming a screen
 * the app can show is the first route; any other leaves `start`), keeps the fragment in step afterwards
 * (`followFragment`), and turns `sui-navigate` events from the app's elements into navigation. With
 * `MountOptions.route: false` the URL is neither read nor written, and `sui-navigate` still works
 */
registerMountStep(ROUTE_STEP, {
    prepare(context) {
        const screens = context.document.screens;
        const view = context.host.ownerDocument.defaultView;
        if (screens === undefined || context.state.route === undefined || context.mountOptions.route === false || view === null) return;
        const parsed = parseFragment(view.location.hash, screens);
        if (parsed === undefined) return;
        if (isRouteRefusal(parsed)) {
            report.warning('The URL names a screen the app cannot show; it starts at its start screen', { reason: parsed.reason });
            return;
        }
        context.state.route = parsed;
    },
    start(context) {
        const screens = context.document.screens;
        if (screens === undefined || context.state.route === undefined) return;
        const { store, host } = context;
        const onRequest = (event: Event): void => {
            const detail = (event as CustomEvent<NavigateRequest | undefined>).detail;
            if (detail === undefined || detail === null || typeof detail.screen !== 'string') return;
            event.stopPropagation();
            const route = routeTo(screens, detail.screen, detail.params);
            if (isRouteRefusal(route)) {
                report.warning('A navigation request was refused', { screen: detail.screen, reason: route.reason });
                return;
            }
            writeRoute(store as never, ROUTE_PATH, route);
        };
        host.addEventListener(NAVIGATE_EVENT, onRequest);
        const view = host.ownerDocument.defaultView;
        const stop = context.mountOptions.route === false || view === null ? undefined : followFragment(context, screens, view);
        return () => {
            host.removeEventListener(NAVIGATE_EVENT, onRequest);
            stop?.();
        };
    }
});
