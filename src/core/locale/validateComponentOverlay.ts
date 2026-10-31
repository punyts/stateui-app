import type { BuildError } from '../errors/index.js';
import { isObject } from '../resolve/merge.js';
import type { PropertyShape, Shape } from '../shape/index.js';
import type { JsonValue } from '../types.js';
import { isContentKey } from './extractBaseOverlay.js';
import { missingPath, notContent } from './errors.js';

const ROOT_PATH = '$';

/** True for text or a (nested) map of text: what a content property may hold in an overlay */
function isText(value: JsonValue): boolean {
    if (typeof value === 'string') return true;
    return isObject(value) && Object.values(value).every(isText);
}

function check(code: string, overlay: Record<string, JsonValue>, properties: Record<string, PropertyShape>, path: string, errors: BuildError[]): void {
    for (const [key, value] of Object.entries(overlay)) {
        const itemPath = `${path}.${key}`;
        const property = Object.hasOwn(properties, key) ? properties[key] : undefined;
        if (property === undefined) {
            errors.push(missingPath(code, itemPath));
        } else if (isContentKey(key)) {
            if (property.kind !== 'content' || !isText(value)) errors.push(notContent(code, key, itemPath));
        } else if (typeof property.items !== 'object' || !isObject(value)) {
            errors.push(notContent(code, key, itemPath));
        } else {
            for (const [entry, fields] of Object.entries(value)) {
                const entryPath = `${itemPath}.${entry}`;
                if (isObject(fields)) check(code, fields, property.items, entryPath, errors);
                else errors.push(notContent(code, entry, entryPath));
            }
        }
    }
}

/**
 * Checks the overlay file of a root component against its shape and returns one `SUI-LOCALE` error per problem:
 * a name that is not a property of the shape (`SUI-LOCALE-PATH`), and a property that is not content, a content value
 * that is not text, or a map whose entries are not objects (`SUI-LOCALE-CONTENT`). The entries of a map property
 * (`columns.<key>`) may have any key and are checked against the item properties. `statePath` is relative to the
 * component's node, which is `$`. Pure; it does not throw for a bad overlay
 */
export function validateComponentOverlay(code: string, overlay: Record<string, JsonValue>, shape: Shape): BuildError[] {
    const errors: BuildError[] = [];
    check(code, overlay, shape.properties, ROOT_PATH, errors);
    return errors;
}
