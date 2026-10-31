import type { ComponentLibrary } from '../resolve/index.js';

/** What `validateLocaleOverlay` needs besides the overlay and the application */
export interface LocaleOverlayOptions {
    /** `ExtractResult.linkedPaths`: a linked property shows data, so an overlay may not set it */
    linkedPaths?: readonly string[];
    /** The components of the document. With it every `_` property is also checked against the shape of its node */
    library?: ComponentLibrary;
    /** The state path of the application root; `$.app` when absent */
    path?: string;
}
