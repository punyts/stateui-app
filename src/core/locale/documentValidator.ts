import type { BuildError } from '../errors/index.js';
import { extractLinks } from '../links/index.js';
import { isObject } from '../resolve/merge.js';
import { registerDocumentValidator } from '../validate/registry.js';
import type { DocumentValidator } from '../validate/types.js';
import type { JsonObject, Node } from '../types.js';
import { validateLocaleOverlay } from './validateLocaleOverlay.js';

const LOCALE_VALIDATOR = 'locale';

/** Removes the properties at the linked paths: a linked property is data, not content */
function withoutLinked(tree: Node, linkedPaths: readonly string[]): JsonObject {
    const copy = structuredClone(tree) as JsonObject;
    for (const path of linkedPaths) {
        const segments = path.split('.').slice(2);
        const last = segments.pop();
        let holder: unknown = copy;
        for (const segment of segments) holder = isObject(holder) ? (holder as JsonObject)[segment] : undefined;
        if (last !== undefined && isObject(holder)) delete (holder as JsonObject)[last];
    }
    return copy;
}

/**
 * The `locale` plug-in validator: checks every `locales.<code>` overlay of the document against the resolved
 * application (content leaves only, existing paths, no linked property, each `_` leaf a content property of its
 * component). It does not report untranslated content, because the component overlays are not part of a document: use
 * `validateAppLocale` for `SUI-LOCALE-MISSING`
 */
export const validateDocumentLocales: DocumentValidator = (context) => {
    const { locales } = context.document;
    if (!isObject(locales)) return [];
    const extracted = extractLinks(context.tree.node, { library: context.library, instances: context.tree.instances });
    const tree = withoutLinked(extracted.tree, extracted.linkedPaths);
    const errors: BuildError[] = [];
    for (const [code, overlay] of Object.entries(locales as Record<string, JsonObject>)) {
        errors.push(...validateLocaleOverlay(code, overlay, tree, { linkedPaths: extracted.linkedPaths, library: context.library }));
    }
    return errors;
};

registerDocumentValidator(LOCALE_VALIDATOR, validateDocumentLocales);
