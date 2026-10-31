import { validateLayouts, validatePlacements } from '../layout/index.js';
import { validateOn } from '../on/index.js';
import type { DocumentValidator } from './types.js';

const validators = new Map<string, DocumentValidator>();

/**
 * Registers a plug-in validator that `validateDocument` runs after its own checks, in registration order, and whose
 * errors it merges. Registering a name again replaces the earlier validator and keeps its place in the order.
 * Returns a function that removes it. The `on` validator (E2.9) is registered here under the name `on`; epic 3
 * registers `layout`, `placement`, `theme` and `locale`
 */
export function registerDocumentValidator(name: string, validator: DocumentValidator): () => void {
    validators.set(name, validator);
    return () => {
        if (validators.get(name) === validator) validators.delete(name);
    };
}

/** The registered validators with their names, in the order they run */
export function documentValidators(): [string, DocumentValidator][] {
    return [...validators.entries()];
}

registerDocumentValidator('on', (context) => validateOn(context.tree, context.library));
registerDocumentValidator('layout', validateLayouts);
registerDocumentValidator('placement', validatePlacements);
