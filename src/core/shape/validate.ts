import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { PREFIXES, RESERVED_KEYS } from '../types.js';
import type { Node } from '../types.js';
import { fitsProperty } from './fit.js';
import type { Shape } from './types.js';

/** Node keys the tree owns; their content is checked with the document, not against the properties */
const TREE_KEYS: readonly string[] = [
    RESERVED_KEYS.component,
    RESERVED_KEYS.children,
    RESERVED_KEYS.placement,
    RESERVED_KEYS.theme,
    RESERVED_KEYS.on
];

/**
 * Checks one node against its shape and returns the violations, each with the state path of the property.
 * Covers unknown properties, `layout` on a component that does not lay out, required properties, value types,
 * allowed values, validators, the URL rule and node-typed slots. A `<-name` link is checked only for its target
 * property: the value comes from the store, not from the node
 */
export function validateNode(shape: Shape, node: Node, statePath: string): BuildError[] {
    const errors: BuildError[] = [];
    const component = node.component;
    const provided = new Set<string>();

    for (const key of Object.keys(node)) {
        if (TREE_KEYS.includes(key)) continue;
        const path = `${statePath}.${key}`;

        if (key === RESERVED_KEYS.layout) {
            if (!shape.layout) errors.push(buildError('SUI-STATE-UNKNOWN', { name: key, path, statePath: path, component }));
            continue;
        }
        if (key.startsWith('$') || key.startsWith(PREFIXES.reserved)) {
            errors.push(buildError('SUI-NODE-NAME', { name: key, path, statePath: path, component }));
            continue;
        }
        if (key.startsWith(PREFIXES.link)) {
            const target = key.slice(PREFIXES.link.length);
            provided.add(target);
            if (!Object.hasOwn(shape.properties, target)) {
                errors.push(buildError('SUI-STATE-UNKNOWN', { name: target, path, statePath: path, component }));
            }
            continue;
        }

        const property = Object.hasOwn(shape.properties, key) ? shape.properties[key] : undefined;
        if (!property) {
            errors.push(buildError('SUI-STATE-UNKNOWN', { name: key, path, statePath: path, component }));
            continue;
        }
        provided.add(key);
        const value = node[key];
        if (value === undefined || !fitsProperty(property, value)) {
            errors.push(buildError('SUI-STATE-INVALID', { name: key, path, statePath: path, component }));
        }
    }

    for (const [name, property] of Object.entries(shape.properties)) {
        if (property.required && !provided.has(name)) {
            const path = `${statePath}.${name}`;
            errors.push(buildError('SUI-STATE-REQUIRED', { name, path, statePath: path, component }));
        }
    }
    return errors;
}
