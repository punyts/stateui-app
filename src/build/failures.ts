import { buildError } from '../core/errors/index.js';
import type { BuildError, ErrorCode } from '../core/errors/index.js';

/** The parts of a component whose build can fail outside the shape and the convention scan */
export type BuildPart = 'template' | 'styles' | 'controller' | 'file';

const CODES: Record<BuildPart, ErrorCode> = {
    template: 'SUI-BUILD-TEMPLATE',
    styles: 'SUI-BUILD-STYLE',
    controller: 'SUI-BUILD-CONTROLLER',
    file: 'SUI-BUILD-IO'
};

/** A `SUI-BUILD` error for a failed part, located by file and, when known, line and column */
export function buildFailure(part: BuildPart, file: string, reason: string, line?: number, column?: number): BuildError {
    return buildError(CODES[part], {
        file,
        name: reason,
        ...(line === undefined ? {} : { line }),
        ...(column === undefined ? {} : { column })
    });
}
