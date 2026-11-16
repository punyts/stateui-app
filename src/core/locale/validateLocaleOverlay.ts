import type { BuildError } from '../errors/index.js';
import { entryShape } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { isNodeValue, isObject } from '../resolve/merge.js';
import type { PropertyShape } from '../shape/index.js';
import type { JsonObject, JsonValue } from '../types.js';
import { isContentKey } from './extractBaseOverlay.js';
import { linkedProperty, missingPath, notContent } from './errors.js';
import type { LocaleOverlayOptions } from './types.js';

const ROOT_PATH = '$.app';

/** What is known about the properties at a place: those of a node, or the item properties of a map */
type Scope = { properties: Record<string, PropertyShape> } | { items: Record<string, PropertyShape> } | undefined;

class Checker {
    readonly errors: BuildError[] = [];
    private readonly linked: ReadonlySet<string>;
    private readonly library: ComponentLibrary | undefined;

    constructor(
        private readonly locale: string,
        options: LocaleOverlayOptions
    ) {
        this.linked = new Set(options.linkedPaths ?? []);
        this.library = options.library;
    }

    scopeOf(app: JsonObject): Scope {
        const name = app.component;
        if (this.library === undefined || typeof name !== 'string' || !Object.hasOwn(this.library, name)) return undefined;
        const shape = entryShape(this.library[name]);
        return shape === undefined ? undefined : { properties: shape.properties };
    }

    /** The scope below `key`: a node has its own, a map property gives its item properties, then each entry uses them */
    private childScope(scope: Scope, key: string, app: JsonValue | undefined): Scope {
        if (isNodeValue(app)) return this.scopeOf(app);
        if (scope === undefined) return undefined;
        if ('items' in scope) return { properties: scope.items };
        const items = Object.hasOwn(scope.properties, key) ? scope.properties[key]?.items : undefined;
        return typeof items === 'object' ? { items } : undefined;
    }

    walk(overlay: JsonObject, app: JsonObject, path: string, scope: Scope): void {
        for (const [key, value] of Object.entries(overlay)) {
            const itemPath = `${path}.${key}`;
            if (this.linked.has(itemPath)) {
                this.errors.push(linkedProperty(this.locale, key, itemPath));
            } else if (!Object.hasOwn(app, key)) {
                this.errors.push(missingPath(this.locale, itemPath));
            } else if (isContentKey(key)) {
                this.content(key, value, app[key], itemPath, scope);
            } else if (!isObject(value)) {
                this.errors.push(notContent(this.locale, key, itemPath));
            } else {
                const inner = app[key];
                if (isObject(inner)) this.walk(value, inner, itemPath, this.childScope(scope, key, inner));
                else this.errors.push(missingPath(this.locale, itemPath));
            }
        }
    }

    /** A `_` property: text, or a content map of text. The shape, when known, must say the property is content */
    private content(key: string, value: JsonValue, app: JsonValue | undefined, path: string, scope: Scope): void {
        const properties = scope !== undefined && 'properties' in scope ? scope.properties : undefined;
        const property = properties !== undefined && Object.hasOwn(properties, key) ? properties[key] : undefined;
        if (properties !== undefined && property?.kind !== 'content') {
            this.errors.push(notContent(this.locale, key, path));
        } else if (typeof value === 'string') {
            return;
        } else if (isObject(value) && isObject(app)) {
            this.entries(value, app, path);
        } else if (isObject(value)) {
            this.errors.push(missingPath(this.locale, path));
        } else {
            this.errors.push(notContent(this.locale, key, path));
        }
    }

    /** The entries of a content map: each must exist, not be linked, and be text or a map of text */
    private entries(value: JsonObject, app: JsonObject, path: string): void {
        for (const [key, item] of Object.entries(value)) {
            const itemPath = `${path}.${key}`;
            const inner = Object.hasOwn(app, key) ? app[key] : undefined;
            if (this.linked.has(itemPath)) {
                this.errors.push(linkedProperty(this.locale, key, itemPath));
            } else if (inner === undefined) {
                this.errors.push(missingPath(this.locale, itemPath));
            } else if (typeof item === 'string') {
                continue;
            } else if (isObject(item) && isObject(inner)) {
                this.entries(item, inner, itemPath);
            } else {
                this.errors.push(notContent(this.locale, key, itemPath));
            }
        }
    }
}

/**
 * Checks a language's overlay against the assembled application (`$.app`, links removed) and returns one `SUI-LOCALE`
 * error per problem: a leaf that is not a `_` property or inside a `_` content map, a linked property
 * (`options.linkedPaths`) and a path the application does not have. Intermediate keys (`columns`, `customer`,
 * `options`) are allowed when the path exists. With `options.library` a `_` property must also be a content
 * property of its component's shape. `code` names the language in the messages. Pure; it does not throw for a bad overlay
 */
export function validateLocaleOverlay(
    code: string,
    overlay: JsonObject,
    app: JsonObject,
    options: LocaleOverlayOptions = {}
): BuildError[] {
    const checker = new Checker(code, options);
    checker.walk(overlay, app, options.path ?? ROOT_PATH, checker.scopeOf(app));
    return checker.errors;
}
