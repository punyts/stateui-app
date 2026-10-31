import { libraryFromCatalog } from '@punyts/stateui-app/core';
import type { CatalogSource } from '@punyts/stateui-app/core';
import { startRuntime } from '@punyts/stateui-app/runtime';
import catalog from '@punyts/stateui-components/catalog.json' with { type: 'json' };
import { register } from '@punyts/stateui-components/register';
import overlays from 'virtual:component-overlays';

/**
 * Entry of the preview runtime bundle: the one script the runtime page loads (E7.2).
 *
 * The page is static, so it cannot carry the per-load nonce in its body. The host puts the nonce in the URL
 * fragment (`<runtime path>/<hash>.html#<nonce>`): a fragment is never sent to the server, and the page reads it
 * here. Without a well-formed nonce the runtime does not start, so a page opened by hand does nothing.
 */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const nonce = window.location.hash.slice(1);

if (NONCE_PATTERN.test(nonce)) {
    register(window);
    startRuntime(window, window.parent, nonce, libraryFromCatalog(catalog as unknown as CatalogSource), {
        componentOverlays: overlays
    });
}
