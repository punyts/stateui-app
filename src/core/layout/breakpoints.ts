import type { COLLAPSE_BELOW } from './lists.js';

/** A container width a `collapseBelow` setting names */
export type Breakpoint = (typeof COLLAPSE_BELOW)[number];

/**
 * The container widths, in px, below which a `grid`, `row` or `region` layout stacks as a column. They are fixed, not
 * tokens: a custom property cannot be used in a container query condition, so the layout sheets are generated from
 * these numbers
 */
export const BREAKPOINTS: Readonly<Record<Breakpoint, number>> = { sm: 480, md: 768, lg: 1024, xl: 1280 };
