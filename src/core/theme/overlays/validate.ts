import { buildError } from '../../errors/index.js';
import type { BuildError } from '../../errors/index.js';
import type { JsonObject, JsonValue } from '../../types.js';
import { checkContrast } from '../contrast.js';
import { TOKENS_STATE_PATH } from '../types.js';
import { mergeOverDefaults, validateTokens } from '../validate.js';
import { KIND_GROUPS, isOverlayKind } from './types.js';

export interface ValidateOverlayOptions {
    /** The overlay's name, used in messages; empty when the tree has none */
    name?: string;
    /** The state path of the tree, for the errors' `statePath`; `$.theme.tokens` when absent */
    statePath?: string;
}

/** The reasons `SUI-THEME-OVERLAY` gives; fixed phrases, never content */
export const OVERLAY_REASONS = {
    group: 'token group outside the kind',
    kind: 'unknown overlay kind',
    unknown: 'no overlay with this name',
    clash: 'name already used by a shipped overlay of the kind',
    reserved: 'name is reserved',
    shape: 'overlay is not a token tree'
} as const;

export function overlayError(
    reason: keyof typeof OVERLAY_REASONS,
    name: string,
    kind: string,
    path: string,
    statePath: string
): BuildError {
    return buildError('SUI-THEME-OVERLAY', { name, other: kind, path, key: OVERLAY_REASONS[reason], statePath });
}

function isTree(value: JsonValue): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function leafPaths(tree: JsonObject, prefix: readonly string[] = []): string[] {
    const paths: string[] = [];
    for (const [key, value] of Object.entries(tree)) {
        const next = [...prefix, key];
        if (isTree(value)) paths.push(...leafPaths(value, next));
        else paths.push(next.join('.'));
    }
    return paths;
}

function allowed(groups: readonly string[], path: string): boolean {
    return groups.some((group) => path === group || path.startsWith(`${group}.`));
}

/**
 * Validates a sparse overlay tree of a kind. A token outside the groups the kind may touch (`mode`: `color`,
 * `elevation`; `brand`: `palette`, `font.family`, `radius`, `icon`; `motion`: `motion`) is `SUI-THEME-OVERLAY` with its
 * path. Every value then gets the `validateTokens` checks (names, paths, types, injection characters, references),
 * and a `mode` overlay merged over the default tree gets the contrast check (`SUI-THEME-CONTRAST` warnings)
 */
export function validateThemeOverlay(kind: string, tree: JsonObject, options: ValidateOverlayOptions = {}): BuildError[] {
    const name = options.name ?? '';
    const base = options.statePath ?? TOKENS_STATE_PATH;
    if (!isOverlayKind(kind)) return [overlayError('kind', name, kind, base, base)];

    const errors: BuildError[] = [];
    for (const path of leafPaths(tree)) {
        if (!allowed(KIND_GROUPS[kind], path)) errors.push(overlayError('group', name, kind, path, `${base}.${path}`));
    }
    for (const error of validateTokens(tree)) {
        errors.push(
            error.statePath?.startsWith(TOKENS_STATE_PATH)
                ? { ...error, statePath: `${base}${error.statePath.slice(TOKENS_STATE_PATH.length)}` }
                : error
        );
    }
    if (errors.length === 0 && kind === 'mode') errors.push(...checkContrast(mergeOverDefaults(tree)));
    return errors;
}
