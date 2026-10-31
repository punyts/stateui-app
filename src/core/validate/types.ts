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
    | { name: string; tier: 'root'; tag: string; shape: Shape }
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
}

/** What a plug-in validator receives: the document whose own checks passed far enough to resolve `app` */
export interface DocumentValidationContext {
    document: AppDocument;
    library: ComponentLibrary;
    /** The resolved `app` tree and the composed names expanded at each path (`resolveNode`) */
    tree: ResolvedTree;
}

/** A plug-in check: returns its errors, each with a state path. It may throw; the run reports that as `SUI-DOC-VALIDATOR` */
export type DocumentValidator = (context: DocumentValidationContext) => BuildError[];
