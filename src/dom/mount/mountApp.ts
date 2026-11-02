import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import { mount, setNodeOptions, setNodeResolver, unmount } from '@punyts/stateui';
import type { NodeOptions } from '@punyts/stateui';
import { buildError, isValid } from '../../core/errors/index.js';
import type { BuildError } from '../../core/errors/index.js';
import type { Link } from '../../core/links/index.js';
import { extractBaseOverlay } from '../../core/locale/index.js';
import { RUNTIME_PATHS, applyLinks, disposeLinks, extractLinks } from '../../core/links/index.js';
import { cloneJson, resolveNode } from '../../core/resolve/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { collectComponentTokens, reflectedProperties } from '../../core/shape/index.js';
import { PREFIXES } from '../../core/types.js';
import type { AppDocument, JsonObject, Node } from '../../core/types.js';
import { validateDocument } from '../../core/validate/index.js';
import type { AppMode } from '../../core/validate/index.js';
import { createDispatcher } from '../on/index.js';
import type { DispatchHooks } from '../on/index.js';
import type { SystemHooks } from '../theme/system.js';
import { ensureAppRoot } from '../app/index.js';
import { nodeThemeMapper } from '../theme/index.js';
import type { ComponentToken } from '../../core/theme/index.js';
import { mountSteps } from './steps.js';
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

function initialState(document: AppDocument, app: Node, mode: AppMode): AppState {
    return {
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
function removeLinked(tree: Node, links: readonly Link[]): void {
    for (const link of links) {
        let holder: unknown = tree;
        for (const segment of link.statePath.split('.').slice(2)) {
            holder = typeof holder === 'object' && holder !== null ? (holder as Record<string, unknown>)[segment] : undefined;
        }
        if (typeof holder === 'object' && holder !== null) delete (holder as Record<string, unknown>)[link.key];
    }
}

const ROW_LINK_TARGET = /^\$row(\.|$)/;

/**
 * A `$row` link in a row template has no target until a record view makes a runtime copy of the template, so it is not
 * applied at start: it goes back into the tree as written (`<-key`), where the component finds it and passes the
 * template to `resolveRowLinks`
 */
function restoreRowLinks(tree: Node, rowLinks: readonly Link[]): void {
    for (const link of rowLinks) {
        let holder: unknown = tree;
        for (const segment of link.statePath.split('.').slice(2)) {
            holder = typeof holder === 'object' && holder !== null ? (holder as Record<string, unknown>)[segment] : undefined;
        }
        if (typeof holder === 'object' && holder !== null) (holder as Record<string, unknown>)[`${PREFIXES.link}${link.key}`] = link.target;
    }
}

function failed(errors: BuildError[]): MountedApp {
    return { store: undefined, baseOverlay: undefined, baseLocale: undefined, errors, raise: () => undefined, dispose: () => undefined };
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
    const context: MountContext = {
        host,
        document,
        library,
        componentTokens: collected.tokens,
        instances: resolved.instances,
        state: initialState(document, extracted.tree, mode),
        options: baseOptions(library, collected.tokens),
        hooks
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
    const dispatcher = createDispatcher({ host, store, library, instances: resolved.instances, rootPath: APP_PATH, hooks });
    const root = host.appendChild(host.ownerDocument.createElement(rootTag));

    let disposed = false;
    return {
        store,
        baseOverlay,
        baseLocale: context.state.locale,
        errors,
        raise(name, payload): void {
            if (!disposed) dispatcher.raise(name, payload);
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            dispatcher.dispose();
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
