import type { AppBlueprint, PartRef } from '../blueprint/types.js';
import { isValid } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import type { AppDocument } from '../types.js';
import { libraryFromCatalog, validateDocument } from '../validate/index.js';
import type { CatalogSource, ValidateDocumentOptions } from '../validate/index.js';
import { assembleApp } from './assembleApp.js';
import type { AppValidation, AppValidationError, PartSource } from './types.js';

export interface ValidateAppOptions extends ValidateDocumentOptions {
    /** The app's part name, for the errors its own parts hold; `app` when absent */
    name?: string;
}

/** The part that holds a state path of the assembled document */
function partOf(path: string, document: AppDocument, blueprint: AppBlueprint, app: PartRef): PartRef {
    const [root, name] = path.split('.').slice(1);
    if (root === 'composed' && name !== undefined && document.composed?.[name] !== undefined) return { kind: 'components', name };
    if ((root === 'theme' || root === 'themes') && document.theme !== undefined) {
        const theme = blueprint.uses?.themes?.[0];
        if (theme !== undefined) return { kind: 'themes', name: theme };
    }
    if (root === 'data' && name !== undefined) {
        const binding = blueprint.uses?.data?.[name];
        if (binding !== undefined && 'dataset' in binding) return { kind: 'data', name: binding.dataset };
    }
    return app;
}

/**
 * Assembles an app and checks the result with `validateDocument`, which checks the shell at `$.app` and each screen's
 * root at `$.screens.{screen}`. Each error names the part that holds it: an owner component (`$.composed.{name}`), the
 * first theme (`$.theme`, `$.themes`), a dataset (`$.data.{binding}`), a logic module (its binding and param errors),
 * or the app itself. The errors of assembling come first
 */
export function validateApp(
    blueprint: AppBlueprint,
    parts: PartSource,
    catalog: ComponentLibrary | CatalogSource,
    options: ValidateAppOptions = {}
): AppValidation {
    const { name = 'app', ...documentOptions } = options;
    const library = Array.isArray((catalog as { components?: unknown }).components)
        ? libraryFromCatalog(catalog as CatalogSource)
        : (catalog as ComponentLibrary);
    const app: PartRef = { kind: 'apps', name };
    const assembled = assembleApp(blueprint, parts, { library });

    // A component assembling already reported missing is not reported again at each node that names it
    const missing = new Set(assembled.errors.flatMap((error) => (error.component === undefined ? [] : [error.component])));
    const reported = (error: BuildError): boolean => !(error.code === 'SUI-NODE-UNKNOWN' && error.component !== undefined && missing.has(error.component));

    const found: BuildError[] = [...assembled.errors, ...validateDocument(assembled.document, library, documentOptions).errors.filter(reported)];

    const errors: AppValidationError[] = found.map((error) => {
        const part = (error as AppValidationError).part ?? partOf(error.statePath ?? '$', assembled.document, blueprint, app);
        return { ...error, part };
    });
    return { valid: isValid(errors), errors, document: assembled.document, uses: assembled.uses };
}
