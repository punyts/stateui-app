import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { mount, setNodeOptions, setNodeResolver, unmount } from '@punyts/stateui';
import type { NodeOptions } from '@punyts/stateui';
import { buildError, isValid } from '../../core/errors/index.js';
import type { BuildError } from '../../core/errors/index.js';
import type { Link } from '../../core/links/index.js';
import { extractBaseOverlay } from '../../core/locale/index.js';
import { RUNTIME_PATHS, applyLinks, disposeLinks, extractLinks } from '../../core/links/index.js';
import { cloneJson, entryShape, resolveNode } from '../../core/resolve/index.js';
import { APP_COMPONENT, ROUTE_PATH, initialRoute, isRouteRefusal, routeTo, screenPath } from '../../core/route/index.js';
import { isNodeValue } from '../../core/resolve/merge.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { collectComponentTokens, nodeChildren, reflectedProperties } from '../../core/shape/index.js';
import { layInstance } from '../../core/snapshot/index.js';
import { PREFIXES } from '../../core/types.js';
import type { AppDocument, AppEventName, JsonObject, JsonValue, Node } from '../../core/types.js';
import { refusedChildren, validateDocument } from '../../core/validate/index.js';
import type { AppMode } from '../../core/validate/index.js';
import { createDispatcher } from '../on/index.js';
import type { DispatchHooks } from '../on/index.js';
import type { SystemHooks } from '../theme/system.js';
import { ensureAppRoot } from '../app/index.js';
import { nodeThemeMapper } from '../theme/index.js';
import type { ComponentToken } from '../../core/theme/index.js';
import { startBrowserLogic } from './logic.js';
import { startScreens, writeRoute } from './screens.js';
import type { ScreenView } from './screens.js';
import { mountSteps } from './steps.js';
import '../route/index.js';
import type { AppState, MountContext, MountedApp, MountOptions, StartedContext } from './types.js';

const DEFAULT_LOCALE = 'en';
const APP_PATH = '$.app';

/** The node resolver and options are global to StateUI; this marks the app that set them last */
let owner: symbol | undefined;

function rootEntry(library: ComponentLibrary, name: string): { tag: string; shape: Parameters<typeof reflectedProperties>[0] } | undefined {
    const entry = Object.hasOwn(library, name) ? library[name] : undefined;
    return entry?.tier === 'root' ? entry : undefined;
}

function baseOptions(library: ComponentLibrary, componentTokens: readonly ComponentToken[]): NodeOptions {
    return {
        theme: nodeThemeMapper(componentTokens),
        reflect: (name) => (rootEntry(library, name) ? reflectedProperties(rootEntry(library, name)!.shape) : [])
    };
}

function initialState(document: AppDocument, app: Node, mode: AppMode, screens: Record<string, Node> | undefined): AppState {
    const route = initialRoute(document);
    return {
        ...(screens === undefined ? {} : { screens }),
        ...(route === undefined ? {} : { route }),
        theme: { tokens: {}, active: {} },
        data: cloneJson((document.data ?? {}) as JsonObject) as JsonObject,
        locale: typeof document.locale === 'string' ? document.locale : DEFAULT_LOCALE,
        app,
        runtime: {
            nodes: {},
            icons: {},
            empty: {},
            sync: { mode, status: mode === 'standalone' ? 'standalone' : 'connecting', waiting: 0 }
        }
    };
}

/**
 * The resolved tree still holds the default of a linked property, and the store refuses to alias a path that holds
 * data, so each linked property is removed from the tree before the store is built
 */
function removeLinked(tree: Node, links: readonly Link[], treePath = APP_PATH): void {
    for (const link of links) {
        let holder: unknown = tree;
        for (const segment of below(link.statePath, treePath)) {
            holder = typeof holder === 'object' && holder !== null ? (holder as Record<string, unknown>)[segment] : undefined;
        }
        if (typeof holder === 'object' && holder !== null) delete (holder as Record<string, unknown>)[link.key];
    }
}

const ROW_LINK_TARGET = /^\$row(\.|$)/;

/** The `childComponents` of the slot of `parent` that holds the node at `path`; undefined when the slot lists none */
function slotAccepts(library: ComponentLibrary, parent: { node: Node; path: string } | undefined, path: string): readonly string[] | undefined {
    if (parent === undefined) return undefined;
    const shape = Object.hasOwn(library, parent.node.component) ? entryShape(library[parent.node.component]) : undefined;
    return nodeChildren(parent.node, parent.path, shape).find((child) => child.path === path)?.accepts;
}

/** True when `path` is `base` or below it */
function atOrBelow(path: string, base: string): boolean {
    return path === base || path.startsWith(`${base}.`);
}

/** The segments of `path` after `base` (`path` is `base` or below it) */
function below(path: string, base: string): string[] {
    return path === base ? [] : path.slice(base.length + 1).split('.');
}

/**
 * The nodes from the root at `base` (`$.app` or a screen) down to the nearest node above `path`, in a copy of the
 * store's tree that holds `node` at `path`, so the node references of a node written after mount resolve as they
 * would in the whole tree. Empty when the parent of `path` does not exist
 */
function ancestorsOf(tree: JsonObject, path: string, node: Node, base: string): { node: Node; path: string }[] {
    const root = cloneJson(tree);
    const segments = below(path, base);
    const ancestors: { node: Node; path: string }[] = [{ node: root as unknown as Node, path: base }];
    let holder: JsonObject = root;
    let holderPath = base;
    for (const segment of segments.slice(0, -1)) {
        const next = holder[segment];
        if (typeof next !== 'object' || next === null || Array.isArray(next)) return [];
        holder = next;
        holderPath = `${holderPath}.${segment}`;
        if (isNodeValue(holder)) ancestors.push({ node: holder as unknown as Node, path: holderPath });
    }
    holder[segments[segments.length - 1] as string] = node as unknown as JsonObject;
    return ancestors;
}

/**
 * A `$row` link in a row template has no target until a record view makes a runtime copy of the template, so it is not
 * applied at start: it goes back into the tree as written (`<-key`), where the component finds it and passes the
 * template to `resolveRowLinks`
 */
function restoreRowLinks(tree: Node, rowLinks: readonly Link[], treePath = APP_PATH): void {
    for (const link of rowLinks) {
        let holder: unknown = tree;
        for (const segment of below(link.statePath, treePath)) {
            holder = typeof holder === 'object' && holder !== null ? (holder as Record<string, unknown>)[segment] : undefined;
        }
        if (typeof holder === 'object' && holder !== null) (holder as Record<string, unknown>)[`${PREFIXES.link}${link.key}`] = link.target;
    }
}

function failed(errors: BuildError[]): MountedApp {
    return {
        store: undefined,
        baseOverlay: undefined,
        screenBaseOverlays: undefined,
        baseLocale: undefined,
        errors,
        raise: () => undefined,
        visibleScreen: () => undefined,
        navigate: (screen) => `the app did not mount, so it cannot navigate to "${screen}"`,
        writeNode: (path) => [buildError('SUI-RUN-WRITE', { path, statePath: path })],
        removeNode: () => false,
        dispose: () => undefined
    };
}

function stepError(name: string): BuildError {
    return buildError('SUI-RUN-BINDING', { component: name, path: '$', statePath: '$' });
}

/**
 * The single way to start an application. It validates the document against the library (a `ComponentLibrary`; the
 * component modules must be registered already, for example with the build's `registerAll`), resolves `composed`,
 * keeps the base-language content overlay (`baseOverlay`, for `switchLocale`), builds the store (`theme`: the document's tokens over the default tree and the active names, `data`, `locale`, `app` and the `runtime` branch), applies the `<-` links, gives
 * `<sui-node>` its resolver and options, mounts the store on `host` and renders `<ui-app-root>`, which holds
 * `<sui-node state="$.app">`.
 *
 * A validation error (a warning does not count), a link that cannot be applied or a step that throws stops the run
 * before anything renders: `store` is undefined and `errors` says why. It does not throw for a bad document.
 * `options.mode` (`standalone` when absent) is how the app keeps its state: the document is validated for it (no
 * `$.server` in Standalone or Persisted) and `$.runtime.sync` starts as `{ mode, status, waiting: 0 }`, with the status
 * `standalone` or `connecting`; the host writes later statuses. `raise` runs the root node's `on` entry for an app
 * event (`sync.rejected`).
 *
 * Outside Full mode the document's `logic` runs in the browser (`startBrowserLogic`): machines and rules look up the
 * store's own writes, and their failures and `notify` events reach the root node's `on` as `logic.failed` and
 * `notify.<name>`. In Full mode the app server runs it.
 *
 * `dispose` removes the root element, unmounts, unlinks, removes the dispatcher's listeners and the node resolver
 * and options, so a second `mountApp` on a fresh host starts clean
 */
export function mountApp(
    host: Element,
    document: AppDocument,
    library: ComponentLibrary,
    hooks: DispatchHooks & SystemHooks = {},
    options: MountOptions = {}
): MountedApp {
    const mode = options.mode ?? 'standalone';
    const validation = validateDocument(document, library, { mode });
    if (!isValid(validation.errors)) return failed(validation.errors);
    const errors = [...validation.errors];
    const collected = collectComponentTokens(
        Object.entries(library).flatMap(([name, entry]) => (entry.tier === 'root' ? [{ file: name, shape: entry.shape }] : []))
    );
    if (!isValid(collected.errors)) return failed([...errors, ...collected.errors]);

    const resolved = resolveNode(cloneJson(document.app as unknown as JsonObject) as Node, library, document.composed);
    const extracted = extractLinks(resolved.node, { library, instances: resolved.instances });
    if (!isValid(extracted.errors)) return failed([...errors, ...extracted.errors]);
    const rowLinks = extracted.links.filter((link) => ROW_LINK_TARGET.test(link.target));
    const appLinks = extracted.links.filter((link) => !ROW_LINK_TARGET.test(link.target));
    removeLinked(extracted.tree, extracted.links);
    const baseOverlay = extractBaseOverlay(extracted.tree, extracted.linkedPaths);
    restoreRowLinks(extracted.tree, rowLinks);

    // Each screen resolves and links as the app node does, at its own root `$.screens.{name}`; a node reference in a
    // screen resolves within that screen, as the validator checks it
    const screens = document.screens;
    let screenTrees: Record<string, Node> | undefined;
    let screenBaseOverlays: Record<string, JsonObject> | undefined;
    for (const [name, screen] of Object.entries(screens ?? {})) {
        const path = screenPath(name);
        const one = resolveNode(cloneJson(screen.root as unknown as JsonObject) as Node, library, document.composed, { path });
        Object.assign(resolved.instances, one.instances);
        const links = extractLinks(one.node, { library, instances: resolved.instances, path });
        if (!isValid(links.errors)) return failed([...errors, ...links.errors]);
        const rows = links.links.filter((link) => ROW_LINK_TARGET.test(link.target));
        appLinks.push(...links.links.filter((link) => !ROW_LINK_TARGET.test(link.target)));
        removeLinked(links.tree, links.links, path);
        screenBaseOverlays = { ...screenBaseOverlays, [name]: extractBaseOverlay(links.tree, links.linkedPaths, path) };
        restoreRowLinks(links.tree, rows, path);
        screenTrees = { ...screenTrees, [name]: links.tree };
    }
    const state = initialState(document, extracted.tree, mode, screenTrees);
    let instanceActive: Record<string, string> = {};
    if (options.instance !== undefined) {
        const laid = layInstance(
            { app: state.app as unknown as JsonObject, ...(screenTrees === undefined ? {} : { screens: screenTrees as unknown as Record<string, JsonObject> }), data: state.data },
            options.instance,
            document
        );
        state.app = laid.app as unknown as Node;
        if (laid.screens !== undefined) state.screens = laid.screens as unknown as Record<string, Node>;
        state.data = laid.data;
        if (laid.route !== undefined) state.route = laid.route;
        instanceActive = laid.active;
        errors.push(...laid.warnings);
    }
    const context: MountContext = {
        host,
        document,
        library,
        componentTokens: collected.tokens,
        instances: resolved.instances,
        state,
        options: baseOptions(library, collected.tokens),
        hooks,
        mountOptions: options,
        instanceActive
    };

    const steps = mountSteps();
    for (const [name, step] of steps) {
        try {
            step.prepare?.(context);
        } catch (error) {
            report.error('mountApp step failed to prepare', { step: name, reason: String(error) });
            return failed([...errors, stepError(name)]);
        }
    }

    const store = createStore<AppState>(context.state);
    store.protect(RUNTIME_PATHS.empty);
    if (context.state.route !== undefined) store.protect(ROUTE_PATH);

    const linkErrors = applyLinks(store, appLinks);
    if (linkErrors.length > 0) {
        disposeLinks(store, appLinks);
        return failed([...errors, ...linkErrors]);
    }

    const disposers: (() => void)[] = [];
    const started: StartedContext = { ...context, store };
    for (const [name, step] of steps) {
        try {
            const dispose = step.start?.(started);
            if (dispose) disposers.push(dispose);
        } catch (error) {
            report.error('mountApp step failed to start', { step: name, reason: String(error) });
            for (const dispose of disposers.reverse()) dispose();
            disposeLinks(store, appLinks);
            return failed([...errors, stepError(name)]);
        }
    }

    const token = Symbol('mountApp');
    owner = token;
    setNodeResolver((name) => rootEntry(library, name)?.tag);
    setNodeOptions(context.options);
    const rootTag = ensureAppRoot(collected.tokens);
    mount(host, store);
    const navigate =
        screens === undefined
            ? undefined
            : (screen: string, params: JsonValue | undefined): string | undefined => {
                  const route = routeTo(screens, screen, params);
                  if (isRouteRefusal(route)) return route.reason;
                  return writeRoute(store as never, ROUTE_PATH, route) ? undefined : `the store refused the write to ${ROUTE_PATH}`;
              };
    const screenRoots = Object.keys(screens ?? {}).map(screenPath);
    const dispatcher = createDispatcher({
        host,
        store,
        library,
        instances: resolved.instances,
        rootPath: APP_PATH,
        roots: screenRoots,
        hooks,
        ...(navigate === undefined ? {} : { navigate })
    });
    const root = host.appendChild(host.ownerDocument.createElement(rootTag));
    const appTag = rootEntry(library, APP_COMPONENT)?.tag;
    const screenView: ScreenView | undefined =
        screens === undefined
            ? undefined
            : startScreens({
                  host,
                  store: store as never,
                  screens: Object.keys(screens),
                  ...(appTag === undefined ? {} : { appTag })
              });
    /** The root (`$.app` or a screen's) that a node written at `path` goes below; undefined for any other path */
    const baseOf = (path: string): string | undefined => [APP_PATH, ...screenRoots].find((base) => path.startsWith(`${base}.`));

    let disposed = false;
    const instances = resolved.instances;
    /** Removes the links of the node at `path` and below, before the node is replaced or removed */
    const dropLinks = (path: string): void => {
        const gone = appLinks.filter((link) => atOrBelow(link.statePath, path));
        disposeLinks(store, gone);
        for (const link of gone) appLinks.splice(appLinks.indexOf(link), 1);
    };
    let stopLogic: (() => void) | undefined;
    try {
        stopLogic =
            mode === 'full'
                ? undefined
                : startBrowserLogic({
                      store: store as never,
                      document,
                      library,
                      tree: resolved,
                      raise: (name, payload) => {
                          if (!disposed) dispatcher.raise(name as AppEventName, payload);
                      },
                      emit: (name, payload) => hooks.onEmit?.(name, payload)
                  });
    } catch (error) {
        report.error('mountApp could not start the logic', { reason: String(error) });
    }
    return {
        store,
        baseOverlay,
        screenBaseOverlays,
        baseLocale: context.state.locale,
        errors,
        raise(name, payload): void {
            if (!disposed) dispatcher.raise(name, payload);
        },
        visibleScreen: () => screenView?.visible(),
        navigate(screen, params): string | undefined {
            if (disposed) return `the app is disposed, so it cannot navigate to "${screen}"`;
            return navigate === undefined ? `the app has no screens, so it cannot navigate to "${screen}"` : navigate(screen, params);
        },
        writeNode(path, node, writeOptions): BuildError[] {
            const refused = [buildError('SUI-RUN-WRITE', { path, statePath: path })];
            const base = baseOf(path);
            if (disposed || base === undefined || !isNodeValue(node)) return refused;
            const one = resolveNode(cloneJson(node as unknown as JsonObject) as Node, library, document.composed, { path });
            if (!isValid(one.errors)) return one.errors;
            const ancestors = ancestorsOf(JSON.parse(JSON.stringify(store.get(base))) as JsonObject, path, one.node, base);
            if (ancestors.length === 0) return refused;
            // A shape component renders only in a drawing or a scene: one that `<sui-node>` would render is refused
            const misplaced = refusedChildren(one.node, path, library, slotAccepts(library, ancestors[ancestors.length - 1], path));
            if (misplaced.length > 0) return misplaced;
            for (const key of Object.keys(instances)) if (atOrBelow(key, path)) delete instances[key];
            Object.assign(instances, one.instances);
            const extracted = extractLinks(one.node, { library, instances, path, ancestors });
            if (!isValid(extracted.errors)) return extracted.errors;
            const rows = extracted.links.filter((link) => ROW_LINK_TARGET.test(link.target));
            const links = extracted.links.filter((link) => !ROW_LINK_TARGET.test(link.target));
            removeLinked(extracted.tree, extracted.links, path);
            restoreRowLinks(extracted.tree, rows, path);
            dropLinks(path);
            if (!store.set(path as never, extracted.tree as never, writeOptions)) return refused;
            appLinks.push(...links);
            // The node is already rendered and a new store link notifies nobody, so each property is first linked to the
            // empty record and then re-pointed at its target: a re-point notifies the listeners the new node registered
            for (const link of links) store.link(`${link.statePath}.${link.key}`, RUNTIME_PATHS.empty);
            return applyLinks(store, links);
        },
        removeNode(path, writeOptions): boolean {
            if (disposed || baseOf(path) === undefined) return false;
            dropLinks(path);
            for (const key of Object.keys(instances)) if (atOrBelow(key, path)) delete instances[key];
            return store.delete(path as never, writeOptions);
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            stopLogic?.();
            dispatcher.dispose();
            screenView?.dispose();
            root.remove();
            unmount(host);
            for (const dispose of disposers.reverse()) {
                try {
                    dispose();
                } catch (error) {
                    report.error('mountApp step failed to dispose', { reason: String(error) });
                }
            }
            disposeLinks(store, appLinks);
            if (owner === token) {
                owner = undefined;
                setNodeResolver(undefined);
                setNodeOptions(undefined);
            }
        }
    };
}
