import { ARTICULATION_NAMES, isArticulationName } from '../articulation/index.js';
import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { PREFIXES, RESERVED_KEYS } from '../types.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import { fitsAnyType, fitsProperty, fitsType, typesOf } from './fit.js';
import type { PropertyShape, Shape } from './types.js';

/**
 * Node keys the tree owns; their content is checked with the document (the `layout` and `placement` validators),
 * not against the properties
 */
const TREE_KEYS: readonly string[] = [
    RESERVED_KEYS.component,
    RESERVED_KEYS.children,
    RESERVED_KEYS.layout,
    RESERVED_KEYS.placement,
    RESERVED_KEYS.theme,
    RESERVED_KEYS.on
];

/** What the caller knows and the shape does not */
export interface ValidateContext {
    /**
     * True when the name is in the icon list. The server reads the list from `icons.json`; without this function
     * any name of lower-case letters, digits and `-` is accepted
     */
    isIconName?(name: string): boolean;
    /** True when the node is itself inside a row template (the value of a `row: true` property), where `$row` is legal */
    insideRow?: boolean;
}

type StateCode = 'SUI-STATE-INVALID' | 'SUI-STATE-UNKNOWN' | 'SUI-STATE-REQUIRED' | 'SUI-STATE-RUNTIME' | 'SUI-NODE-NAME';

function isObject(value: JsonValue | undefined): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRowReference(value: JsonValue): value is string {
    return typeof value === 'string' && (value === '$row' || value.startsWith('$row.'));
}

function sameJson(a: JsonValue | undefined, b: JsonValue): boolean {
    return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

interface Walk {
    component: string;
    context: ValidateContext;
    errors: BuildError[];
}

function report(walk: Walk, code: StateCode, name: string, path: string): void {
    walk.errors.push(buildError(code, { name, path, statePath: path, component: walk.component }));
}

/**
 * Reports a property the shape does not have. For a shared property (`tone`, `size`, ...) the component does not
 * support, `other` carries the supported ones so the message can name them
 */
function reportUnknown(walk: Walk, shape: Shape, name: string, path: string): void {
    if (!isArticulationName(name)) {
        report(walk, 'SUI-STATE-UNKNOWN', name, path);
        return;
    }
    const supported = ARTICULATION_NAMES.filter((entry) => Object.hasOwn(shape.properties, entry));
    walk.errors.push(
        buildError('SUI-STATE-SHARED', {
            name,
            path,
            statePath: path,
            component: walk.component,
            other: supported.length > 0 ? supported.join(', ') : 'none'
        })
    );
}

/** Reports every required property and every conditionally required property that has no value or link */
function checkRequired(
    properties: Record<string, PropertyShape>,
    present: ReadonlySet<string>,
    linked: ReadonlySet<string>,
    values: JsonObject,
    base: string,
    walk: Walk
): void {
    for (const [name, property] of Object.entries(properties)) {
        if (present.has(name)) continue;
        const path = `${base}.${name}`;
        if (property.required) {
            report(walk, 'SUI-STATE-REQUIRED', name, path);
            continue;
        }
        const condition = property.requiredWhen;
        if (!condition || linked.has(condition.property)) continue;
        const actual = values[condition.property] ?? properties[condition.property]?.default;
        const holds = 'equals' in condition ? sameJson(actual, condition.equals) : !sameJson(actual, condition.notEquals);
        if (holds) {
            walk.errors.push(
                buildError('SUI-STATE-CONDITION', {
                    name,
                    path,
                    statePath: path,
                    component: walk.component,
                    other: condition.property
                })
            );
        }
    }
}

/** Checks the fields of one map item against the item shape */
function checkItem(items: Record<string, PropertyShape>, entry: JsonObject, base: string, walk: Walk): void {
    const present = new Set<string>();
    for (const key of Object.keys(entry)) {
        const path = `${base}.${key}`;
        if (key.startsWith('$') || key.startsWith(PREFIXES.reserved)) {
            report(walk, 'SUI-NODE-NAME', key, path);
            continue;
        }
        const property = Object.hasOwn(items, key) ? items[key] : undefined;
        if (!property) {
            report(walk, 'SUI-STATE-UNKNOWN', key, path);
            continue;
        }
        present.add(key);
        checkValue(property, entry[key] as JsonValue, key, path, walk);
    }
    checkRequired(items, present, new Set(), entry, base, walk);
}

/** Walks a map so each violation carries the path with the map key */
function checkMap(property: PropertyShape, value: JsonObject, base: string, walk: Walk): void {
    const items = property.items;
    for (const [key, entry] of Object.entries(value)) {
        const path = `${base}.${key}`;
        if (items === 'string') {
            if (typeof entry !== 'string') report(walk, 'SUI-STATE-INVALID', key, path);
        } else if (items !== undefined) {
            if (isObject(entry)) checkItem(items, entry, path, walk);
            else report(walk, 'SUI-STATE-INVALID', key, path);
        }
    }
}

/** True when an object value is read as a map: the property has a map type and no other type takes the object */
function readsAsMap(property: PropertyShape, value: JsonValue): value is JsonObject {
    const types = typesOf(property);
    return types.includes('map') && isObject(value) && !types.some((type) => type !== 'map' && fitsType(type, value));
}

/** Checks one value against its property: types, allowed values, validators, icon names and map contents */
function checkValue(property: PropertyShape, value: JsonValue, name: string, path: string, walk: Walk): void {
    if (readsAsMap(property, value)) {
        const before = walk.errors.length;
        checkMap(property, value, path, walk);
        if (walk.errors.length === before && !fitsProperty(property, value)) report(walk, 'SUI-STATE-INVALID', name, path);
        return;
    }
    if (!fitsProperty(property, value)) {
        report(walk, 'SUI-STATE-INVALID', name, path);
        return;
    }
    const isIconName = walk.context.isIconName;
    if (!isIconName || typeof value !== 'string' || value === '') return;
    const types = typesOf(property);
    const takenByOtherType = types.some((type) => type !== 'icon' && type !== 'map' && fitsType(type, value));
    if (types.includes('icon') && !takenByOtherType && fitsAnyType(property, value) && !isIconName(value)) {
        report(walk, 'SUI-STATE-INVALID', name, path);
    }
}

function reportRow(walk: Walk, target: string, path: string): void {
    walk.errors.push(buildError('SUI-LINK-ROW', { target, path, statePath: path, component: walk.component }));
}

function scanOn(value: JsonValue, path: string, walk: Walk): void {
    if (isRowReference(value)) {
        reportRow(walk, value, path);
    } else if (Array.isArray(value)) {
        value.forEach((entry, index) => scanOn(entry, `${path}.${index}`, walk));
    } else if (isObject(value)) {
        for (const [key, entry] of Object.entries(value)) scanOn(entry, `${path}.${key}`, walk);
    }
}

/** Looks for `$row` links and `on` entries in a value that has no shape here, such as a nested node */
function scanGeneric(value: JsonValue, path: string, walk: Walk): void {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => scanGeneric(entry, `${path}.${index}`, walk));
    } else if (isObject(value)) {
        for (const [key, entry] of Object.entries(value)) {
            if (key === RESERVED_KEYS.children) continue;
            const child = `${path}.${key}`;
            if (key === RESERVED_KEYS.on) scanOn(entry, child, walk);
            else if (key.startsWith(PREFIXES.link)) {
                if (isRowReference(entry)) reportRow(walk, entry, child);
            } else scanGeneric(entry, child, walk);
        }
    }
}

/** Looks for `$row` in a property value, leaving out `row: true` properties and map fields */
function scanValue(property: PropertyShape, value: JsonValue, path: string, walk: Walk): void {
    if (property.row) return;
    const items = property.items;
    if (typeof items === 'object' && readsAsMap(property, value)) {
        for (const [key, entry] of Object.entries(value)) {
            if (!isObject(entry)) continue;
            for (const [field, fieldValue] of Object.entries(entry)) {
                const fieldProperty = Object.hasOwn(items, field) ? items[field] : undefined;
                const fieldPath = `${path}.${key}.${field}`;
                if (fieldProperty) scanValue(fieldProperty, fieldValue, fieldPath, walk);
                else scanGeneric(fieldValue, fieldPath, walk);
            }
        }
        return;
    }
    scanGeneric(value, path, walk);
}

function scanRow(shape: Shape, node: Node, statePath: string, walk: Walk): void {
    for (const key of Object.keys(node)) {
        const path = `${statePath}.${key}`;
        const value = node[key] as JsonValue;
        if (key === RESERVED_KEYS.on) {
            scanOn(value, path, walk);
        } else if (key.startsWith(PREFIXES.link)) {
            if (isRowReference(value)) reportRow(walk, value, path);
        } else if (!TREE_KEYS.includes(key)) {
            const property = Object.hasOwn(shape.properties, key) ? shape.properties[key] : undefined;
            if (property) scanValue(property, value, path, walk);
        }
    }
}

/**
 * Checks one node against its shape and returns the violations, each with the state path of the property.
 * Covers unknown properties, required and conditionally required
 * properties, runtime properties set by a node, value types, allowed values, validators, the URL rule, icon names
 * (checked with `context.isIconName` when given), node-typed slots and the contents of maps (with the map key in
 * the path). `$row` in a link or an `on` entry of the node, or inside a slot value that is not a `row: true`
 * property, is `SUI-LINK-ROW`; the caller sets `context.insideRow` for a node that is itself inside a row template.
 * A `<-name` link is checked only for its target property: the value comes from the store, not from the node
 */
export function validateNode(shape: Shape, node: Node, statePath: string, context: ValidateContext = {}): BuildError[] {
    const walk: Walk = { component: node.component, context, errors: [] };
    const present = new Set<string>();
    const linked = new Set<string>();

    for (const key of Object.keys(node)) {
        if (TREE_KEYS.includes(key)) continue;
        const path = `${statePath}.${key}`;

        if (key.startsWith('$') || key.startsWith(PREFIXES.reserved)) {
            report(walk, 'SUI-NODE-NAME', key, path);
            continue;
        }
        if (key.startsWith(PREFIXES.link)) {
            const target = key.slice(PREFIXES.link.length);
            present.add(target);
            linked.add(target);
            const linkedProperty = Object.hasOwn(shape.properties, target) ? shape.properties[target] : undefined;
            if (!linkedProperty) reportUnknown(walk, shape, target, path);
            else if (linkedProperty.runtime) report(walk, 'SUI-STATE-RUNTIME', target, path);
            continue;
        }

        const property = Object.hasOwn(shape.properties, key) ? shape.properties[key] : undefined;
        if (!property) {
            reportUnknown(walk, shape, key, path);
            continue;
        }
        present.add(key);
        if (property.runtime) {
            report(walk, 'SUI-STATE-RUNTIME', key, path);
            continue;
        }
        const value = node[key];
        if (value === undefined) report(walk, 'SUI-STATE-INVALID', key, path);
        else checkValue(property, value, key, path, walk);
    }

    checkRequired(shape.properties, present, linked, node, statePath, walk);
    if (!context.insideRow) scanRow(shape, node, statePath, walk);
    return walk.errors;
}
