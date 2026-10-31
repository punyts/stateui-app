import type { JsonObject } from '../types.js';
import type { Shape } from './types.js';

/** The default state of a shape: every property that has a default, as a fresh copy the caller may change */
export function buildDefaults(shape: Shape): JsonObject {
    const state: JsonObject = {};
    for (const [name, property] of Object.entries(shape.properties)) {
        if (property.default !== undefined) state[name] = JSON.parse(JSON.stringify(property.default));
    }
    return state;
}
