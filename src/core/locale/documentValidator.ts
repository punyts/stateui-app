import type { BuildError } from '../errors/index.js';
import { extractLinks } from '../links/index.js';
import { isObject } from '../resolve/merge.js';
import { screenPath } from '../route/outlet.js';
import { registerDocumentValidator } from '../validate/registry.js';
import type { ResolvedTree } from '../on/index.js';
import type { DocumentValidator } from '../validate/types.js';
import type { JsonObject, Node } from '../types.js';
import { validateLocaleOverlay } from './validateLocaleOverlay.js';

const LOCALE_VALIDATOR = 'locale';

/** Removes the properties at the linked paths: a linked property is data, not content */
function withoutLinked(tree: Node, linkedPaths: readonly string[], root: string): JsonObject {
    const copy = structuredClone(tree) as JsonObject;
    const depth = root.split('.').length;
    for (const path of linkedPaths) {
        const segments = path.split('.').slice(depth);
        const last = segments.pop();
        let holder: unknown = copy;
        for (const segment of segments) holder = isObject(holder) ? (holder as JsonObject)[segment] : undefined;
        if (last !== undefined && isObject(holder)) delete (holder as JsonObject)[last];
    }
    return copy;
}

/** The errors of the overlays of one root (the shell or a screen) against its resolved tree */
function checkRoot(
    locales: Readonly<Record<string, JsonObject>>,
    tree: ResolvedTree,
    library: Parameters<DocumentValidator>[0]['library'],
    path: string
): BuildError[] {
    const extracted = extractLinks(tree.node, { library, instances: tree.instances, path });
    const content = withoutLinked(extracted.tree, extracted.linkedPaths, path);
    const errors: BuildError[] = [];
    for (const [code, overlay] of Object.entries(locales)) {
        errors.push(...validateLocaleOverlay(code, overlay, content, { linkedPaths: extracted.linkedPaths, library, path }));
    }
    return errors;
}

/**
 * The `locale` plug-in validator: checks every `locales.<code>` overlay of the document against the resolved
 * application, and every `screens.<name>.locales.<code>` against that screen's resolved root (content leaves only,
 * existing paths, no linked property, each `_` leaf a content property of its component). It does not report untranslated content, because the component overlays are not part of a document: use
 * `validateAppLocale` for `SUI-LOCALE-MISSING`
 */
export const validateDocumentLocales: DocumentValidator = (context) => {
    const { locales, screens } = context.document;
    const errors: BuildError[] = [];
    if (isObject(locales)) errors.push(...checkRoot(locales as Record<string, JsonObject>, context.tree, context.library, '$.app'));
    for (const [name, tree] of Object.entries(context.screens ?? {})) {
        const screenLocales = isObject(screens) && Object.hasOwn(screens, name) ? screens[name]?.locales : undefined;
        if (isObject(screenLocales)) errors.push(...checkRoot(screenLocales as Record<string, JsonObject>, tree, context.library, screenPath(name)));
    }
    return errors;
};

registerDocumentValidator(LOCALE_VALIDATOR, validateDocumentLocales);
