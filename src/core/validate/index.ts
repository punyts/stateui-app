export { documentValidators, registerDocumentValidator } from './registry.js';
export { libraryFromCatalog, validateDocument } from './validateDocument.js';
export { PAINTS_PROPERTY, validatePaints, validateShapeLabels } from './paint.js';
export { MAX_SCENES_PER_PAGE, SCENE3D_COMPONENT, validateSceneCount } from './scenes.js';
export { checkSharedData } from './sharedData.js';
export { childRefusal, isShapeComponent, refusedChildren } from './tree.js';
export type {
    AppMode,
    CatalogComponent,
    CatalogSource,
    DocumentValidation,
    DocumentValidationContext,
    DocumentValidator,
    ValidateDocumentOptions
} from './types.js';
