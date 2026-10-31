import { mergeOverDefaults } from '../../core/theme/index.js';
import type { JsonObject } from '../../core/types.js';
import { registerMountStep } from '../mount/steps.js';

/** The names `$.theme.active` holds unless the document gives others */
export const DEFAULT_ACTIVE: Readonly<Record<string, string>> = { mode: 'light', brand: 'default', motion: 'full' };

export const THEME_STEP = 'theme';

/**
 * Fills `$.theme` before the store exists: the document's `theme.tokens` over the default tree, and the active names
 * over `{ mode: "light", brand: "default", motion: "full" }`. The document was validated by then
 */
registerMountStep(THEME_STEP, {
    prepare(context) {
        const theme = context.document.theme;
        context.state.theme = {
            tokens: mergeOverDefaults(theme?.tokens ?? {}) as JsonObject,
            active: { ...DEFAULT_ACTIVE, ...(theme?.active ?? {}) }
        };
    }
});
