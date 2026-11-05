import type { Store, WriteOptions } from '@punyts/state';
import type { NodeOptions } from '@punyts/stateui';
import type { BuildError } from '../../core/errors/index.js';
import type { ComponentToken } from '../../core/theme/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import type { RouteState } from '../../core/route/index.js';
import type { AppDocument, AppEventName, JsonObject, JsonValue, Node } from '../../core/types.js';
import type { AppMode } from '../../core/validate/index.js';
import type { DispatchHooks } from '../on/index.js';
import type { SystemHooks } from '../theme/system.js';

/** The shape of the store `mountApp` builds */
export interface AppState {
    /** Every token value (the document's over the default tree) and the active overlay name per kind */
    theme: { tokens: JsonObject; active: Record<string, string> };
    /** A copy of the document's `data` */
    data: JsonObject;
    /** The document's locale; `"en"` when it gives none */
    locale: string;
    /** The resolved `app` tree, without its `<-` links (they are store aliases) */
    app: Node;
    /** Each screen's resolved root by name, without its `<-` links; only for a document with screens */
    screens?: Record<string, Node>;
    /** The visible screen and its params; only for a document with screens. Protected: only `navigate` writes it */
    route?: RouteState;
    /** Never from the document: controller state and shared values */
    runtime: {
        /** The runtime branch of each node (`runtimePath`) */
        nodes: JsonObject;
        /** Icon path data, written by the host's `load` message */
        icons: JsonObject;
        /** The shared empty record that record views and `current` point at; protected, so nothing writes into it */
        empty: JsonObject;
        /** The sync status the host writes: the mode, `standalone`, `connecting`, `online` or `offline`, and the changes waiting */
        sync: { mode: AppMode; status: string; waiting: number };
    };
}

/** What a step sees while it prepares */
export interface MountContext {
    host: Element;
    document: AppDocument;
    library: ComponentLibrary;
    /** The component tokens the library's shapes declare (E3.11), each once, sorted by path */
    componentTokens: readonly ComponentToken[];
    /** The composed names expanded at each state path (`ResolveResult.instances`) */
    instances: Readonly<Record<string, string[]>>;
    /** The initial state before the store is created: `prepare` may replace `theme` and `locale` */
    state: AppState;
    /** The options given to `<sui-node>`; `prepare` may add `theme` and extend `reflect` */
    options: NodeOptions;
    hooks: DispatchHooks & SystemHooks;
}

/** What a step sees in `start`: the store is there, links are applied, nothing has rendered yet */
export interface StartedContext extends MountContext {
    store: Store<AppState>;
}

/**
 * A plug-in step of `mountApp`. Epic 3 registers the theme (E3.4) and locale (E3.19) steps instead of
 * `mountApp` knowing them. `prepare` runs before the store exists, `start` after links are applied and before the
 * first render; `start` may return a function that `dispose` calls
 */
export interface MountStep {
    prepare?(context: MountContext): void;
    start?(context: StartedContext): (() => void) | void;
}

/** How `mountApp` mounts an app */
export interface MountOptions {
    /** How the app keeps its state; `standalone` when absent */
    mode?: AppMode;
}

/** What `mountApp` returns */
export interface MountedApp {
    /** The store mounted on the host; undefined when `errors` holds an error and nothing was rendered */
    store: Store<AppState> | undefined;
    /** The content of the application as mounted, as an overlay of every unlinked `_` property; undefined with `store` */
    baseOverlay: JsonObject | undefined;
    /**
     * The content of each screen as mounted, by screen name, relative to `$.screens.{name}`: the base-language entries
     * of `switchLocale`'s `screens`. Undefined without screens or without `store`
     */
    screenBaseOverlays: Record<string, JsonObject> | undefined;
    /** The language of `baseOverlay`: the document's `locale`, `"en"` when it gives none; undefined with `store` */
    baseLocale: string | undefined;
    /** Validation warnings, or the errors that stopped the run; empty for a clean document */
    errors: BuildError[];
    /** Runs the root node's `on` entry for an app event with the payload; nothing when the app did not mount */
    raise(name: AppEventName, payload?: unknown): void;
    /** The screen that shows (`$.route.screen` once mounted); undefined for an app without screens */
    visibleScreen(): string | undefined;
    /** Runs `navigate`: moves `$.route` to `screen` with `params`. Returns why it cannot, undefined when it moved */
    navigate(screen: string, params?: JsonValue): string | undefined;
    /**
     * Mounts a node written after start at `path` (below `$.app` or a screen's `$.screens.{name}`), as a load would: component defaults and composed
     * components resolved, its `<-` links applied (node references resolve against the whole app) and the links of the
     * node it replaces removed. A plain store write of a node does none of this. Returns the errors; empty when it mounted
     */
    writeNode(path: string, node: Node, options?: WriteOptions): BuildError[];
    /** Removes the node at `path` with its links. False when nothing was removed */
    removeNode(path: string, options?: WriteOptions): boolean;
    /** Unmounts, unlinks and removes listeners. Safe to call more than once */
    dispose(): void;
}
