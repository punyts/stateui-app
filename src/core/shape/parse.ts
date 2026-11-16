import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import type { JsonValue } from '../types.js';
import { applyShapeIncludes } from './includes.js';
import type { ShapePartials } from './includes.js';
import { SHAPE_KEYS, applyKeys, finishShape } from './table.js';
import type { Shape } from './types.js';

/** The outcome of reading a shape file: the shape when there are no errors, and every error found */
export interface ShapeResult {
    shape?: Shape;
    errors: BuildError[];
}

/** How `parseShape` reads a state file */
export interface ParseShapeOptions {
    /**
     * The shared shape partials a state file may name in `includes`, by name (the file `<name>.json` of the library's
     * shared shape folder), each the file text or its parsed value. Without it every included name is unknown
     */
    partials?: ShapePartials;
}

/** The camel-cased component name a shape file name gives: `text-label.state.json` is `textLabel` */
function componentName(file: string): string {
    const base = file.split('/').pop() as string;
    const stem = base.replace(/\.state\.json$/, '').replace(/\.json$/, '');
    return stem.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

/**
 * Reads a `*.state.json`. `json` is the file text or the already parsed value; `file` names the file in every
 * error. Every problem is reported, not just the first. `shape` is set only when there are no errors. An `includes`
 * list merges the named `options.partials` under the file's own `properties`, `events` and `tokens` before the
 * shape is read (`applyShapeIncludes`), so the shape and every check see the merged result
 */
export function parseShape(json: unknown, file: string, options: ParseShapeOptions = {}): ShapeResult {
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
    const context = { file, errors, where: '', component: componentName(file) };
    const merged = applyShapeIncludes(input as { [key: string]: JsonValue }, file, options.partials, errors);
    applyKeys(SHAPE_KEYS, merged, shape, context);
    finishShape(shape, context);
    return errors.length > 0 ? { errors } : { shape, errors };
}
