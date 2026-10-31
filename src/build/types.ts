import type { BuildError } from '../core/errors/index.js';
import type { Catalog } from './catalog.js';
import type { ScannedComponent } from '../core/convention/index.js';

/** What a CSS transform or check is told about the stylesheet it is given */
export interface CssContext {
    /** The camel-cased component name */
    component: string;
    /** The path of the `view.css` file, relative to the library folder, with forward slashes */
    file: string;
}

/** Turns a component's CSS text into CSS text; runs before StateUI compiles it */
export type CssTransform = (css: string, context: CssContext) => string;

/**
 * Inspects a component's CSS text, as written in the file, and returns `SUI-BUILD` errors.
 * Each error should carry the file, line and column
 */
export type CssCheck = (css: string, context: CssContext) => BuildError[];

export interface BuildOptions {
    /** Applied in order, each to the output of the one before; none by default */
    cssTransforms?: readonly CssTransform[];
    /** Run on the CSS before any transform, so the lines they report match the file; none by default */
    cssChecks?: readonly CssCheck[];
}

/** A root component that built: its scan record and the files written for it, relative to the out folder */
export interface BuiltComponent {
    component: ScannedComponent;
    files: string[];
}

export interface BuildResult {
    /** The root components that built, sorted by name */
    built: BuiltComponent[];
    /** Every problem found, including those from the scan; a component with an error has no module */
    errors: BuildError[];
    /** Every file written, relative to the out folder, sorted */
    files: string[];
    /** The content of `catalog.json`: every component that built, sorted by name */
    catalog: Catalog;
}
