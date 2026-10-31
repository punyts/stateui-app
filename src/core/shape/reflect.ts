import type { Shape } from './types.js';

/**
 * The names of the properties `<sui-node>` writes as host attributes, in shape order. The shape is the only
 * source of this list: the application gives it to `<sui-node>` as the `reflect(componentName)` list
 */
export function reflectedProperties(shape: Shape): string[] {
    return Object.entries(shape.properties)
        .filter(([, property]) => property.reflect)
        .map(([name]) => name);
}
