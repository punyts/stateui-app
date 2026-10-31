import brandDefault from './brand.default.json' with { type: 'json' };
import modeContrast from './mode.contrast.json' with { type: 'json' };
import modeDark from './mode.dark.json' with { type: 'json' };
import modeLight from './mode.light.json' with { type: 'json' };
import motionFull from './motion.full.json' with { type: 'json' };
import motionReduced from './motion.reduced.json' with { type: 'json' };
import type { ThemeOverlays } from './types.js';

/**
 * The overlays the library ships. `light`, `default` and `full` carry the whole of their kind's groups, so applying
 * one restores everything another overlay of the kind changed; `reduced` sets every duration to 0
 */
export const SHIPPED_OVERLAYS: ThemeOverlays = {
    mode: { light: modeLight, dark: modeDark, contrast: modeContrast },
    brand: { default: brandDefault },
    motion: { full: motionFull, reduced: motionReduced }
};
