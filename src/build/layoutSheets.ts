import type { BuildError } from '../core/errors/index.js';
import { generateLayoutSheets } from '../dom/layout/index.js';
import { buildFailure } from './failures.js';
import type { CssTransform } from './types.js';

/**
 * The transform the build runs for every root component whose shape supports `layout`: it prepends the layout
 * stylesheets, so the component carries the rules for every layout type, the container queries of `collapseBelow` and
 * the container types of its host and its `layout-host`
 */
export const prependLayoutSheets: CssTransform = (css) => `${generateLayoutSheets()}${css}`;

/** The number of lines the layout sheets add in front of a layout-capable component's CSS */
export const LAYOUT_SHEET_LINES = generateLayoutSheets().split('\n').length - 1;

const TAG = /<([A-Za-z][^\s/>]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g;

/** True when an element of the view carries the `layout-host` attribute; comments and attribute values do not count */
export function hasLayoutHost(view: string): boolean {
    const text = view.replace(/<!--[\s\S]*?-->/g, '');
    for (const tag of text.matchAll(TAG)) {
        for (const attribute of (tag[2] ?? '').matchAll(ATTRIBUTE)) {
            if (attribute[1] === 'layout-host') return true;
        }
    }
    return false;
}

/**
 * A component whose shape supports `layout` needs a `layout-host` in its view, and a view with a `layout-host` needs
 * a shape that supports `layout`; either mismatch is a `SUI-BUILD` error naming the view file
 */
export function checkLayoutHost(view: string, supportsLayout: boolean, file: string): BuildError[] {
    const host = hasLayoutHost(view);
    if (supportsLayout && !host) {
        return [buildFailure('template', file, 'the shape supports "layout" but the view has no element with a layout-host attribute')];
    }
    if (!supportsLayout && host) {
        return [buildFailure('template', file, 'the view has a layout-host element but the shape does not support "layout"')];
    }
    return [];
}
