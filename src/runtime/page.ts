import type { ComponentLibrary } from '../core/resolve/index.js';
import type { FunctionCatalog } from '../core/functions/index.js';
import type { ComponentOverlays } from '../core/locale/index.js';
import type { mountApp } from '../dom/mount/index.js';
import type { RuntimeCore, RuntimeCoreOptions } from './createRuntime.js';

/** The global the page bundle sets: `window.stateuiPage` */
export const PAGE_GLOBAL = 'stateuiPage';

/**
 * What the page bundle (`dist/runtime-bundle/<page>.js`) gives a page that mounts apps in its own elements: the
 * component library it registered, its function catalogs and locale overlays, `mountApp` with them at hand, and the
 * runtime for an app whose host drives it with messages (a live app synced by its host), mounted `inPage`
 */
export interface StateuiPage {
    readonly library: ComponentLibrary;
    readonly functions: readonly FunctionCatalog[];
    readonly componentOverlays: ComponentOverlays;
    readonly mountApp: typeof mountApp;
    /**
     * `createRuntime` in the page: on `host`, with the library, its functions and overlays, `inPage`, no route, and the
     * 3D chunk looked for beside the page bundle's script; `apps` is the page's app host for its `embeddedApp` nodes
     */
    createRuntime(options: Pick<RuntimeCoreOptions, 'host' | 'nonce' | 'post' | 'apps'>): RuntimeCore;
}
