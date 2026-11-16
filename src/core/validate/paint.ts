import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { entryShape, resolveNode } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { isObject } from '../resolve/merge.js';
import { colorForm, nodeChildren } from '../shape/index.js';
import type { PropertyShape, Shape } from '../shape/index.js';
import { PREFIXES } from '../types.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import type { DocumentValidationContext } from './types.js';

/** The property of a drawing that holds its gradients by paint name */
export const PAINTS_PROPERTY = 'paints';

const APP_PATH = '$.app';
const EXPOSES = 'exposes';

/**
 * The paint names a shape may use: the keys of the nearest ancestor's `paints`. `unknown` when that value is not
 * written out (a link), so no name can be checked; absent outside any node with a `paints` property
 */
type PaintScope = { names: ReadonlySet<string> } | 'unknown' | undefined;

type Visit = (node: Node, path: string, shape: Shape | undefined, scope: PaintScope) => void;

function shapeOf(library: ComponentLibrary, component: string): Shape | undefined {
    return Object.hasOwn(library, component) ? entryShape(library[component]) : undefined;
}

/** The scope a node opens for itself and its subtree: its own `paints` when its shape has that property */
function scopeOf(node: JsonObject, shape: Shape | undefined, outer: PaintScope): PaintScope {
    if (shape === undefined || !Object.hasOwn(shape.properties, PAINTS_PROPERTY)) return outer;
    if (Object.hasOwn(node, `${PREFIXES.link}${PAINTS_PROPERTY}`)) return 'unknown';
    const paints = node[PAINTS_PROPERTY];
    return { names: new Set(isObject(paints as JsonValue) ? Object.keys(paints as JsonObject) : []) };
}

/** Walks one resolved tree, giving each node the paint scope of its nearest ancestor (or itself) with `paints` */
function walk(root: Node, rootPath: string, library: ComponentLibrary, visit: Visit): void {
    const step = (node: Node, path: string, outer: PaintScope): void => {
        const shape = shapeOf(library, node.component);
        const scope = scopeOf(node, shape, outer);
        visit(node, path, shape, scope);
        for (const child of nodeChildren(node, path, shape)) step(child.node as Node, child.path, scope);
    };
    step(root, rootPath, undefined);
}

/** The resolved `app` tree, each screen and each composed tree on its own; a composed tree starts with no paint scope */
function forEachTree(context: DocumentValidationContext, visit: Visit): void {
    walk(context.tree.node, APP_PATH, context.library, visit);
    for (const [name, tree] of Object.entries(context.screens ?? {})) walk(tree.node, `$.screens.${name}`, context.library, visit);
    const composed = context.document.composed;
    if (composed === undefined || !isObject(composed as JsonValue)) return;
    for (const [name, tree] of Object.entries(composed)) {
        if (!isObject(tree) || typeof tree.component !== 'string') continue;
        const path = `$.composed.${name}`;
        const own: JsonObject = { ...tree };
        delete own[EXPOSES];
        walk(resolveNode(own as Node, context.library, composed, { path }).node, path, context.library, visit);
    }
}

/** Calls `check` for each written string value of a `color` property: the shape's own and the fields of map items, at any depth */
function forEachColor(values: JsonObject, properties: Record<string, PropertyShape>, path: string, check: (name: string, value: string, at: string) => void): void {
    for (const [name, property] of Object.entries(properties)) {
        if (!Object.hasOwn(values, name) || Object.hasOwn(values, `${PREFIXES.link}${name}`)) continue;
        const value = values[name];
        const at = `${path}.${name}`;
        if (property.validators.color === true && typeof value === 'string') check(name, value, at);
        if (typeof property.items !== 'object' || !isObject(value as JsonValue)) continue;
        for (const [key, item] of Object.entries(value as JsonObject)) {
            if (isObject(item)) forEachColor(item, property.items, `${at}.${key}`, check);
        }
    }
}

/**
 * The `paint` plug-in of `validateDocument` (G1.3 of the graphics epic 1). It reads every written value of a property
 * whose shape has the `color` validator (also inside map items, such as a gradient's stops): a paint name the nearest
 * ancestor's `paints` (the drawing's gradients, the node itself included) does not define is `SUI-STATE-PAINT`; a
 * token reference `{group.name}` the theme does not have is `SUI-STATE-TOKEN`, asked through `context.hasToken`.
 * Without `hasToken` the tokens are checked by syntax only (the `color` validator). A value given by a link (`<-fill`)
 * is not read, and neither is a paint name where the `paints` are a link or where no ancestor has `paints` (a shape
 * outside a drawing is `SUI-NODE-CHILD`; a composed tree's drawing is where it is used). Each error is at the
 * property's state path
 */
export function validatePaints(context: DocumentValidationContext): BuildError[] {
    const errors: BuildError[] = [];
    const hasToken = context.hasToken;
    forEachTree(context, (node, path, shape, scope) => {
        if (shape === undefined) return;
        forEachColor(node, shape.properties, path, (name, value, at) => {
            const form = colorForm(value);
            if (form === 'token' && hasToken !== undefined && !hasToken(value.slice(1, -1))) {
                errors.push(buildError('SUI-STATE-TOKEN', { name, path: at, token: value, statePath: at }));
            }
            if (form === 'paint' && scope !== undefined && scope !== 'unknown' && !scope.names.has(value)) {
                errors.push(buildError('SUI-STATE-PAINT', { name, path: at, key: value, statePath: at }));
            }
        });
    });
    return errors;
}

/**
 * The `label` plug-in of `validateDocument`: a warning (`SUI-STATE-LABEL`) for a node whose shape has an `interactive`
 * property, which the node sets to `true`, and which has no `_label` (missing, empty or blank) and no `<-_label` link.
 * An interactive shape is a button to the keyboard and to a screen reader, and `_label` is its name
 */
export function validateShapeLabels(context: DocumentValidationContext): BuildError[] {
    const errors: BuildError[] = [];
    forEachTree(context, (node, path, shape) => {
        if (shape === undefined || !Object.hasOwn(shape.properties, 'interactive')) return;
        const values = node as JsonObject;
        if (values['interactive'] !== true || Object.hasOwn(values, `${PREFIXES.link}_label`)) return;
        const label = values['_label'];
        if (typeof label === 'string' && label.trim() !== '') return;
        errors.push(buildError('SUI-STATE-LABEL', { component: node.component, path, statePath: path }));
    });
    return errors;
}
