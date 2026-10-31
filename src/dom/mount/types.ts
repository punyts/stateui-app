import type { Store } from '@punyts/state';
import type { NodeOptions } from '@punyts/stateui';
import type { BuildError } from '../../core/errors/index.js';
import type { ComponentToken } from '../../core/theme/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import type { AppDocument, JsonObject, Node } from '../../core/types.js';
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
    /** Never from the document: controller state and shared values */
    runtime: {
        /** The runtime branch of each node (`runtimePath`) */
        nodes: JsonObject;
        /** Icon path data, written by the host's `load` message */
        icons: JsonObject;
        /** The shared empty record that record views and `current` point at; protected, so nothing writes into it */
        empty: JsonObject;
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

/** What `mountApp` returns */
export interface MountedApp {
    /** The store mounted on the host; undefined when `errors` holds an error and nothing was rendered */
    store: Store<AppState> | undefined;
    /** The content of the application as mounted, as an overlay of every unlinked `_` property; undefined with `store` */
    baseOverlay: JsonObject | undefined;
    /** The language of `baseOverlay`: the document's `locale`, `"en"` when it gives none; undefined with `store` */
    baseLocale: string | undefined;
    /** Validation warnings, or the errors that stopped the run; empty for a clean document */
    errors: BuildError[];
    /** Unmounts, unlinks and removes listeners. Safe to call more than once */
    dispose(): void;
}
