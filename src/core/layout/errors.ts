import { buildError } from '../errors/index.js';
import type { BuildError, ErrorCode, ErrorDetails } from '../errors/index.js';

/** The SUI-LAYOUT codes of this folder */
export type LayoutErrorCode = Extract<ErrorCode, `SUI-LAYOUT-${string}`>;

/** Builds a `SUI-LAYOUT` error */
export function layoutError(code: LayoutErrorCode, details: ErrorDetails): BuildError {
    return buildError(code, details);
}
