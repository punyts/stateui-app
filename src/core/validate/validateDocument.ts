import { buildError, isValid } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { checkLimits } from '../limits.js';
import { checkExposes, EXPOSES_KEY } from '../convention/index.js';
import { resolveNode } from '../resolve/index.js';
import type { ComponentLibrary, LibraryEntry } from '../resolve/index.js';
import { isObject } from '../resolve/merge.js';
import type { AppDocument, JsonObject, JsonValue, Node } from '../types.js';
import { checkOrderedKeys, checkRoot, checkServerUse } from './document.js';
import { documentValidators } from './registry.js';
import type { CatalogSource, DocumentValidation, ValidateDocumentOptions } from './types.js';
import { checkTree } from './tree.js';

const APP_PATH = '$.app';

function isCatalog(source: ComponentLibrary | CatalogSource): source is CatalogSource {
    return Array.isArray((source as { components?: unknown }).components);
}

/**
 * The library the resolver and validators read, from the entries of `catalog.json`. The catalog keeps a declared
 * `placement` beside `shape`; it goes back into the shape, where the layout validator reads it
 */
export function libraryFromCatalog(catalog: CatalogSource): ComponentLibrary {
    const library: Record<string, LibraryEntry> = {};
    for (const component of catalog.components) {
        library[component.name] =
            component.tier === 'root'
                ? {
                      tier: 'root',
                      tag: component.tag,
                      shape:
                          component.placement === undefined
                              ? component.shape
                              : { ...component.shape, placement: component.placement }
                  }
                : { tier: 'composed', tree: component.tree };
    }
    return library;
}

/** Every error carries a state path; one without a location points at the document */
function located(errors: readonly BuildError[]): BuildError[] {
    return errors.map((error) => (error.statePath === undefined ? { ...error, statePath: '$' } : error));
}

function runChecks(
    document: Record<string, JsonValue>,
    library: ComponentLibrary,
    options: ValidateDocumentOptions
): BuildError[] {
    const errors: BuildError[] = [...checkRoot(document), ...checkOrderedKeys(document)];
    if (options.mode === 'standalone' || options.mode === 'persisted') errors.push(...checkServerUse(document, options.mode));
    const app = document['app'];
    if (!isObject(app) || typeof app['component'] !== 'string') return errors;

    const composed = (isObject(document['composed']) ? document['composed'] : {}) as Record<string, Node>;
    const data = document['data'];

    const resolved = resolveNode(app as Node, library, composed);
    errors.push(...resolved.errors, ...checkTree(resolved.node, resolved.instances, APP_PATH, library, data, options));

    for (const [name, tree] of Object.entries(composed)) {
        if (!isObject(tree) || typeof tree['component'] !== 'string') continue;
        const path = `$.composed.${name}`;
        const own: JsonObject = { ...tree };
        delete own[EXPOSES_KEY];
        const result = resolveNode(own as Node, library, composed, { path });
        errors.push(
            ...result.errors.filter((error) => error.code !== 'SUI-DOC-COMPOSED'),
            ...checkTree(result.node, result.instances, path, library, data, options)
        );
        if (tree[EXPOSES_KEY] !== undefined) {
            for (const issue of checkExposes(tree[EXPOSES_KEY], own as Node, library, composed)) {
                const where = issue.path === '' ? `${path}.${EXPOSES_KEY}` : `${path}.${EXPOSES_KEY}.${issue.path}`;
                errors.push(buildError('SUI-DOC-EXPOSES', { key: issue.path === '' ? EXPOSES_KEY : issue.path, name: issue.reason, statePath: where }));
            }
        }
    }

    const context = { document: document as unknown as AppDocument, library, tree: { node: resolved.node, instances: resolved.instances } };
    for (const [name, validator] of documentValidators()) {
        try {
            errors.push(...validator(context));
        } catch {
            errors.push(buildError('SUI-DOC-VALIDATOR', { name, statePath: '$' }));
        }
    }
    return errors;
}

/**
 * Runs every structural check on a document without a DOM and returns all errors in one pass, each with a state
 * path. `catalog` is the component library (`ComponentLibrary`) or the content of `catalog.json`.
 *
 * Order: a value that is not an object is `SUI-DOC-SHAPE`; then the closed limits (`checkLimits`), and a breach
 * returns only the limit errors, so nothing is resolved or walked. Then the root keys and their types, integer-like
 * keys in ordered maps and under `data`, the `app` and `composed` trees (every component resolves, composed cycles,
 * reserved names, merged nodes fit their shapes, `_` properties belong to their component, `<-` targets exist and
 * do not loop), and finally the registered plug-in validators (`on`, and the layout, placement, theme and locale
 * validators of epic 3), whose errors are merged. `valid` ignores warnings. Never throws
 */
export function validateDocument(
    document: unknown,
    catalog: ComponentLibrary | CatalogSource,
    options: ValidateDocumentOptions = {}
): DocumentValidation {
    let errors: BuildError[];
    try {
        if (!isObject(document as JsonValue)) {
            errors = [buildError('SUI-DOC-SHAPE', { statePath: '$' })];
        } else {
            const limits = checkLimits(document as unknown as AppDocument);
            errors =
                limits.length > 0
                    ? limits
                    : runChecks(
                          document as Record<string, JsonValue>,
                          isCatalog(catalog) ? libraryFromCatalog(catalog) : catalog,
                          options
                      );
        }
    } catch {
        errors = [buildError('SUI-DOC-SHAPE', { statePath: '$' })];
    }

    const all = located(errors);
    return { valid: isValid(all), errors: all };
}
