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
import { reflectedProperties } from '../../core/shape/index.js';
import type { AppDocument, JsonObject, Node } from '../../core/types.js';
import { validateDocument } from '../../core/validate/index.js';
import { createDispatcher } from '../on/index.js';
import type { DispatchHooks } from '../on/index.js';
import { APP_ROOT_TAG, ensureAppRoot } from './appRoot.js';
import { mountSteps } from './steps.js';
import type { AppState, MountContext, MountedApp, StartedContext } from './types.js';

const DEFAULT_LOCALE = 'en';
const APP_PATH = '$.app';

/** The node resolver and options are global to StateUI; this marks the app that set them last */
let owner: symbol | undefined;

function rootEntry(library: ComponentLibrary, name: string): { tag: string; shape: Parameters<typeof reflectedProperties>[0] } | undefined {
    const entry = Object.hasOwn(library, name) ? library[name] : undefined;
    return entry?.tier === 'root' ? entry : undefined;
}

function baseOptions(library: ComponentLibrary): NodeOptions {
    return { reflect: (name) => (rootEntry(library, name) ? reflectedProperties(rootEntry(library, name)!.shape) : []) };
}

function initialState(document: AppDocument, app: Node): AppState {
    return {
        theme: { tokens: {}, active: {} },
        data: cloneJson((document.data ?? {}) as JsonObject) as JsonObject,
        locale: typeof document.locale === 'string' ? document.locale : DEFAULT_LOCALE,
        app,
        runtime: { nodes: {}, icons: {}, empty: {} }
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

function failed(errors: BuildError[]): MountedApp {
    return { store: undefined, baseOverlay: undefined, baseLocale: undefined, errors, dispose: () => undefined };
}

function stepError(name: string): BuildError {
    return buildError('SUI-RUN-BINDING', { component: name, path: '$', statePath: '$' });
}

/**
 * The single way to start an application. It validates the document against the library (a `ComponentLibrary`; the
 * component modules must be registered already, for example with the build's `registerAll`), resolves `composed`,
 * keeps the base-language content overlay (`baseOverlay`, for `switchLocale`), builds the store (`theme`, `data`, `locale`, `app` and the `runtime` branch), applies the `<-` links, gives
 * `<sui-node>` its resolver and options, mounts the store on `host` and renders `<ui-app-root>`, which holds
 * `<sui-node state="$.app">`.
 *
 * A validation error (a warning does not count), a link that cannot be applied or a step that throws stops the run
 * before anything renders: `store` is undefined and `errors` says why. It does not throw for a bad document.
 * `dispose` removes the root element, unmounts, unlinks, removes the dispatcher's listeners and the node resolver
 * and options, so a second `mountApp` on a fresh host starts clean
 */
export function mountApp(
    host: Element,
    document: AppDocument,
    library: ComponentLibrary,
    hooks: DispatchHooks = {}
): MountedApp {
    const validation = validateDocument(document, library);
    if (!isValid(validation.errors)) return failed(validation.errors);
    const errors = [...validation.errors];

    const resolved = resolveNode(cloneJson(document.app as unknown as JsonObject) as Node, library, document.composed);
    const extracted = extractLinks(resolved.node, { library, instances: resolved.instances });
    if (!isValid(extracted.errors)) return failed([...errors, ...extracted.errors]);
    removeLinked(extracted.tree, extracted.links);
    const baseOverlay = extractBaseOverlay(extracted.tree, extracted.linkedPaths);
    const context: MountContext = {
        host,
        document,
        library,
        instances: resolved.instances,
        state: initialState(document, extracted.tree),
        options: baseOptions(library),
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

    const linkErrors = applyLinks(store, extracted.links);
    if (linkErrors.length > 0) {
        disposeLinks(store, extracted.links);
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
            disposeLinks(store, extracted.links);
            return failed([...errors, stepError(name)]);
        }
    }

    const token = Symbol('mountApp');
    owner = token;
    setNodeResolver((name) => rootEntry(library, name)?.tag);
    setNodeOptions(context.options);
    ensureAppRoot();
    mount(host, store);
    const dispatcher = createDispatcher({ host, store, library, instances: resolved.instances, rootPath: APP_PATH, hooks });
    const root = host.appendChild(host.ownerDocument.createElement(APP_ROOT_TAG));

    let disposed = false;
    return {
        store,
        baseOverlay,
        baseLocale: context.state.locale,
        errors,
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
            disposeLinks(store, extracted.links);
            if (owner === token) {
                owner = undefined;
                setNodeResolver(undefined);
                setNodeOptions(undefined);
            }
        }
    };
}
