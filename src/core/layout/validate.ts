import type { BuildError } from '../errors/index.js';
import { resolveNode } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { isObject } from '../resolve/merge.js';
import { fitsProperty, nodeChildren } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import { RESERVED_KEYS } from '../types.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import type { DocumentValidationContext } from '../validate/types.js';
import { layoutError } from './errors.js';
import { fitsField } from './fits.js';
import { LAYOUTS, isLayoutType } from './lists.js';
import type { LayoutType } from './lists.js';

const APP_PATH = '$.app';
const EXPOSES = 'exposes';

function shapeOf(library: ComponentLibrary, component: string): Shape | undefined {
    if (!Object.hasOwn(library, component)) return undefined;
    const entry = library[component];
    return entry?.tier === 'root' ? entry.shape : undefined;
}

/** The node a child sits under: its layout and its component's declared placement shape decide what the child may place */
interface Parent {
    node: JsonObject;
    path: string;
    shape: Shape | undefined;
}

type Check = (node: Node, path: string, shape: Shape | undefined, parent: Parent | undefined) => void;

/** Walks one resolved tree and calls `check` for every node with its parent */
function walk(root: Node, rootPath: string, library: ComponentLibrary, check: Check): void {
    const visit = (node: Node, path: string, parent: Parent | undefined): void => {
        const shape = shapeOf(library, node.component);
        check(node, path, shape, parent);
        for (const child of nodeChildren(node, path, shape)) {
            visit(child.node as Node, child.path, { node, path, shape });
        }
    };
    visit(root, rootPath, undefined);
}

/** The trees to check: the resolved `app` tree and every composed tree on its own */
function forEachTree(context: DocumentValidationContext, check: Check): void {
    walk(context.tree.node, APP_PATH, context.library, check);
    const composed = context.document.composed;
    if (composed === undefined || !isObject(composed as JsonValue)) return;
    for (const [name, tree] of Object.entries(composed)) {
        if (!isObject(tree) || typeof tree.component !== 'string') continue;
        const path = `$.composed.${name}`;
        const own: JsonObject = { ...tree };
        delete own[EXPOSES];
        const result = resolveNode(own as Node, context.library, composed, { path });
        walk(result.node, path, context.library, check);
    }
}

/** The layout type a node declares, when it declares a valid one */
function layoutTypeOf(node: JsonObject): LayoutType | undefined {
    const layout = node[RESERVED_KEYS.layout];
    if (layout === undefined || !isObject(layout)) return undefined;
    return isLayoutType(layout.type) ? layout.type : undefined;
}

function checkLayout(node: Node, path: string, shape: Shape | undefined, errors: BuildError[]): void {
    if (!Object.hasOwn(node, RESERVED_KEYS.layout) || shape === undefined) return;
    const at = `${path}.${RESERVED_KEYS.layout}`;
    if (!shape.layout) {
        errors.push(layoutError('SUI-LAYOUT-UNSUPPORTED', { component: node.component, path: at, statePath: at }));
        return;
    }
    const layout = node[RESERVED_KEYS.layout] as JsonValue;
    if (!isObject(layout)) {
        errors.push(layoutError('SUI-LAYOUT-SHAPE', { path: at, statePath: at }));
        return;
    }
    if (!isLayoutType(layout.type)) {
        errors.push(layoutError('SUI-LAYOUT-TYPE', { path: at, statePath: at }));
        return;
    }
    const settings = LAYOUTS[layout.type].settings;
    for (const [name, value] of Object.entries(layout)) {
        if (name === 'type') continue;
        const settingPath = `${at}.${name}`;
        const spec = Object.hasOwn(settings, name) ? settings[name] : undefined;
        if (spec === undefined) {
            errors.push(layoutError('SUI-LAYOUT-SETTING', { name, path: settingPath, statePath: settingPath }));
        } else if (!fitsField(spec, value)) {
            errors.push(layoutError('SUI-LAYOUT-VALUE', { name, path: settingPath, statePath: settingPath }));
        }
    }
}

/** Checks each placement field against the parent's declared placement shape, or else the placement of its layout type */
function checkFields(placement: JsonObject, at: string, parent: Parent, type: LayoutType | undefined, errors: BuildError[]): void {
    const declared = parent.shape?.placement;
    for (const [name, value] of Object.entries(placement)) {
        const fieldPath = `${at}.${name}`;
        const details = { name, path: fieldPath, statePath: fieldPath };
        if (declared !== undefined) {
            const property = Object.hasOwn(declared, name) ? declared[name] : undefined;
            if (property === undefined) errors.push(layoutError('SUI-LAYOUT-FIELD', details));
            else if (!fitsProperty(property, value)) errors.push(layoutError('SUI-LAYOUT-PLACEMENT', details));
            continue;
        }
        const fields = LAYOUTS[type as LayoutType].placement;
        const spec = Object.hasOwn(fields, name) ? fields[name] : undefined;
        if (spec === undefined) errors.push(layoutError('SUI-LAYOUT-FIELD', details));
        else if (!fitsField(spec, value)) errors.push(layoutError('SUI-LAYOUT-PLACEMENT', details));
    }
}

function checkPlacement(node: Node, path: string, parent: Parent | undefined, errors: BuildError[]): void {
    const at = `${path}.${RESERVED_KEYS.placement}`;
    const present = Object.hasOwn(node, RESERVED_KEYS.placement);
    const declared = parent?.shape?.placement;
    const value = node[RESERVED_KEYS.placement] as JsonValue | undefined;

    if (present && !isObject(value as JsonValue)) {
        errors.push(layoutError('SUI-LAYOUT-SHAPE', { path: at, statePath: at }));
        return;
    }
    const placement = (present ? value : {}) as JsonObject;

    if (parent !== undefined && declared !== undefined) {
        checkFields(placement, at, parent, undefined, errors);
        for (const [name, property] of Object.entries(declared)) {
            if (property.required && !Object.hasOwn(placement, name)) {
                errors.push(layoutError('SUI-LAYOUT-REQUIRED', { name, path: at, statePath: at }));
            }
        }
        return;
    }
    if (!present) return;

    if (parent === undefined) {
        // A composed component's own root carries a default placement for where it is used; only the app root has none
        if (path === APP_PATH) errors.push(layoutError('SUI-LAYOUT-ROOT', { path: at, statePath: at }));
        return;
    }
    if (!Object.hasOwn(parent.node, RESERVED_KEYS.layout)) {
        errors.push(
            layoutError('SUI-LAYOUT-PARENT', { name: parent.node.component as string, other: parent.path, path: at, statePath: at })
        );
        return;
    }
    // An invalid parent layout is reported by the layout validator; the child is not checked against it
    const type = layoutTypeOf(parent.node);
    if (type !== undefined) checkFields(placement, at, parent, type, errors);
}

/**
 * The `layout` plug-in of `validateDocument`: a `layout` on a component whose shape does not support it, a layout
 * that is not an object with a known `type`, an unknown setting and a setting value outside its list
 */
export function validateLayouts(context: DocumentValidationContext): BuildError[] {
    const errors: BuildError[] = [];
    forEachTree(context, (node, path, shape) => checkLayout(node, path, shape, errors));
    return errors;
}

/**
 * The `placement` plug-in of `validateDocument`: a child's `placement` against its parent's layout type or declared
 * placement shape (unknown field, value outside its list, missing required field), and a `placement` under a parent
 * that has neither, which names the parent
 */
export function validatePlacements(context: DocumentValidationContext): BuildError[] {
    const errors: BuildError[] = [];
    forEachTree(context, (node, path, _shape, parent) => checkPlacement(node, path, parent, errors));
    return errors;
}
