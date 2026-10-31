import { generateSharedSheet } from '../dom/articulation/index.js';
import type { CssTransform } from './types.js';

/**
 * The transform the build always runs first: it prepends the shared articulation stylesheet to a root component's
 * CSS, so every component class carries the same attribute-to-custom-property rules in its own sheet (StateUI shares
 * one constructed sheet per class, not across classes)
 */
export const prependSharedSheet: CssTransform = (css) => `${generateSharedSheet()}${css}`;

/** The number of lines the shared sheet adds in front of a component's own CSS */
export const SHARED_SHEET_LINES = generateSharedSheet().split('\n').length - 1;
