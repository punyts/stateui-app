import type { BuildError } from '../errors/index.js';
import type { ResolvedTree } from '../on/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import type { Shape } from '../shape/index.js';
import type { AppDocument, Node } from '../types.js';

/** The result of `validateDocument`: `valid` is true when no error has severity `"error"` (warnings are allowed) */
export interface DocumentValidation {
    valid: boolean;
    errors: BuildError[];
}

/** A component entry of `catalog.json` as far as validation needs it; the build's `Catalog` entries fit it */
export type CatalogComponent =
    | { name: string; tier: 'root'; tag: string; shape: Shape; placement?: Shape['placement'] }
    | { name: string; tier: 'composed'; tree: Node };

/** The part of `catalog.json` that validation reads */
export interface CatalogSource {
    components: readonly CatalogComponent[];
}

export interface ValidateDocumentOptions {
    /**
     * True when the name is in the icon list (the server reads the list from `icons.json`). Without it any name of
     * lower-case letters, digits and `-` is accepted
     */
    isIconName?(name: string): boolean;
    /**
     * How the app keeps its state. In `standalone` and `persisted` mode there is no app server, so a document that
     * names `$.server` anywhere is refused (`SUI-DOC-SERVER`); `full` and absent allow it. A link into `$.server` is
     * refused in every mode (`SUI-LINK-SERVER`)
     */
    mode?: AppMode;
}

/** How an app keeps its state: browser only, the statenet without server logic, or an app server */
export type AppMode = 'standalone' | 'persisted' | 'full';

/** What a plug-in validator receives: the document whose own checks passed far enough to resolve `app` */
export interface DocumentValidationContext {
    document: AppDocument;
    library: ComponentLibrary;
    /** The resolved `app` tree and the composed names expanded at each path (`resolveNode`) */
    tree: ResolvedTree;
    /** The resolved root of each screen, by screen name; its state path is `$.screens.{screen}` */
    screens?: Readonly<Record<string, ResolvedTree>>;
}

/** A plug-in check: returns its errors, each with a state path. It may throw; the run reports that as `SUI-DOC-VALIDATOR` */
export type DocumentValidator = (context: DocumentValidationContext) => BuildError[];
