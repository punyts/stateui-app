import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import type { JsonValue } from '../types.js';
import { SHAPE_KEYS, applyKeys, finishShape } from './table.js';
import type { Shape } from './types.js';

/** The outcome of reading a shape file: the shape when there are no errors, and every error found */
export interface ShapeResult {
    shape?: Shape;
    errors: BuildError[];
}

/**
 * Reads a `*.state.json`. `json` is the file text or the already parsed value; `file` names the file in every
 * error. Every problem is reported, not just the first. `shape` is set only when there are no errors
 */
export function parseShape(json: unknown, file: string): ShapeResult {
    let input: unknown = json;
    if (typeof json === 'string') {
        try {
            input = JSON.parse(json);
        } catch {
            return { errors: [buildError('SUI-BUILD-SHAPE', { file, name: 'json' })] };
        }
    }
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { errors: [buildError('SUI-BUILD-SHAPE', { file, name: '$' })] };
    }

    const shape: Shape = { summary: '', properties: {}, shared: [], events: [], commands: [], layout: false };
    const errors: BuildError[] = [];
    const context = { file, errors, where: '' };
    applyKeys(SHAPE_KEYS, input as { [key: string]: JsonValue }, shape, context);
    finishShape(shape, context);
    return errors.length > 0 ? { errors } : { shape, errors };
}
