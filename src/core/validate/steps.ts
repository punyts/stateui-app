import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { forEachTree } from '../layout/validate.js';
import type { Shape } from '../shape/index.js';
import type { Node } from '../types.js';
import type { DocumentValidationContext } from './types.js';

const TOLERANCE = 1e-9;

function isNumberProperty(shape: Shape, name: string): boolean {
    return Object.hasOwn(shape.properties, name) && shape.properties[name]?.type === 'number';
}

/** True when `min` is not a whole number of `step`s (compared with a tolerance, since 0.3 / 0.1 is not exact) */
function offGrid(min: number, step: number): boolean {
    const steps = min / step;
    return Math.abs(steps - Math.round(steps)) > TOLERANCE * Math.max(1, Math.abs(steps));
}

/**
 * The `step` plug-in of `validateDocument`: a warning (`SUI-STATE-STEP`) for a node whose component has the number
 * properties `min` and `step` (the number field) when both are written as numbers, `step` is above 0 and `min` is not
 * a multiple of `step`. Such a field counts its allowed values from `min` (0.01, 1.01, 2.01, ...), so a whole number
 * such as 1250 is refused. A value given by a `<-` link is not read.
 *
 * It is a document validator and not part of `validateNode` because the shape has no cross-property rule: it knows each
 * property's type and range, not how two of them relate, and the rule needs both values of one node
 */
export function validateSteps(context: DocumentValidationContext): BuildError[] {
    const errors: BuildError[] = [];
    forEachTree(context, (node: Node, path, shape) => {
        if (shape === undefined || !isNumberProperty(shape, 'min') || !isNumberProperty(shape, 'step')) return;
        const { min, step } = node as Record<string, unknown>;
        if (typeof min !== 'number' || typeof step !== 'number' || !Number.isFinite(min) || !Number.isFinite(step) || step <= 0) return;
        if (!offGrid(min, step)) return;
        errors.push(buildError('SUI-STATE-STEP', { component: node.component, name: String(min), other: String(step), path, statePath: path }));
    });
    return errors;
}
