import type { ComposedPart, DatasetPart, LogicModule, ModelPart, PartRef, ThemePart } from '../blueprint/types.js';
import type { BuildError } from '../errors/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import type { AppDocument } from '../types.js';

/** The owner's parts an app can use, by name; plain maps, so assembling does no IO */
export interface PartSource {
    themes?: Readonly<Record<string, ThemePart>>;
    modules?: Readonly<Record<string, LogicModule>>;
    models?: Readonly<Record<string, ModelPart>>;
    datasets?: Readonly<Record<string, DatasetPart>>;
    components?: Readonly<Record<string, ComposedPart>>;
}

export interface AssembleOptions {
    /**
     * The component library. With it, a component name that is neither an owner component nor a library component
     * is `SUI-USES-MISSING`; without it, such a name is left to `validateDocument` (`SUI-NODE-UNKNOWN`)
     */
    library?: ComponentLibrary;
}

export interface AssembleResult {
    /** The document the runtime mounts: `app` is the shell, `screens` the screens */
    document: AppDocument;
    /** `SUI-USES-MISSING` for each part named in `uses` (or a component in a node) that the owner does not have */
    errors: BuildError[];
    /** Every owner part the app reads, once each, in the order found: themes, data, modules, components */
    uses: PartRef[];
}

/** An error of an app validation, with the part that holds its path */
export interface AppValidationError extends BuildError {
    part: PartRef;
}

export interface AppValidation {
    valid: boolean;
    errors: AppValidationError[];
    /** The assembled document that was checked */
    document: AppDocument;
    uses: PartRef[];
}
