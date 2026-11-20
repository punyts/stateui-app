import { libraryFromCatalog } from '@punyts/stateui-app/core';
import type { CatalogSource } from '@punyts/stateui-app/core';
import { mountApp } from '@punyts/stateui-app';
import { createRuntime, PAGE_GLOBAL } from '@punyts/stateui-app/runtime';
import type { StateuiPage } from '@punyts/stateui-app/runtime';
import catalog from '@punyts/stateui-components/catalog.json' with { type: 'json' };
import { COMPONENT_FUNCTIONS } from '@punyts/stateui-components/functions';
import { register } from '@punyts/stateui-components/register';
import overlays from 'virtual:component-overlays';

/**
 * Entry of the page bundle: the script a page loads to mount apps in its own elements rather than in frames. It
 * registers the component library and sets `window.stateuiPage` (`StateuiPage`), which a host script (the live view of
 * `@punyts/stateui-mcp`) and the page's own scripts use
 */
register(window);
const library = libraryFromCatalog(catalog as unknown as CatalogSource);
const functions = [COMPONENT_FUNCTIONS];
/** The folder of this script: the server serves the 3D chunk beside it */
const script = document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : '';
const chunkBase = script === '' ? './' : new URL('./', script).href;

const page: StateuiPage = {
    library,
    functions,
    componentOverlays: overlays,
    mountApp,
    createRuntime: (options) => createRuntime({ ...options, library, componentOverlays: overlays, functions, inPage: true, chunkBase })
};

(window as unknown as Record<string, unknown>)[PAGE_GLOBAL] = page;
