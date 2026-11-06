import type { BuildError } from '../core/errors/index.js';
import type { ComponentToken } from '../core/theme/index.js';
import type { Catalog } from './catalog.js';
import type { ScannedComponent } from '../core/convention/index.js';

/** What a CSS transform or check is told about the stylesheet it is given */
export interface CssContext {
    /** The camel-cased component name */
    component: string;
    /** The path of the `view.css` file, relative to the library folder, with forward slashes */
    file: string;
    /** The component tokens the whole library declares (E3.11); empty when no shape declares any */
    tokens: readonly ComponentToken[];
}

/** Turns a component's CSS text into CSS text; runs before StateUI compiles it */
export type CssTransform = (css: string, context: CssContext) => string;

/**
 * Inspects a component's CSS text, as written in the file, and returns `SUI-BUILD` errors.
 * Each error should carry the file, line and column
 */
export type CssCheck = (css: string, context: CssContext) => BuildError[];

export interface BuildOptions {
    /**
     * A folder of shared stylesheets. A line `@include "<name>.css";` in a component's `view.css` is replaced with
     * that file before the checks and transforms run, so the token lint also covers the partial; an unknown file is a
     * `SUI-BUILD` error with the line. Lines reported after an include count the inlined text. Off by default
     */
    sharedCssDir?: string;
    /** The descriptions of the semantic tokens by dotted path; the library's own `tokens.descriptions.json` by default */
    tokenDescriptions?: Readonly<Record<string, string>>;
    /** Applied in order, each to the output of the one before; none by default */
    cssTransforms?: readonly CssTransform[];
    /** Run on the CSS before any transform, so the lines they report match the file; none by default */
    cssChecks?: readonly CssCheck[];
    /**
     * When true, a root component without `category` or `purposes` and a composed file without `summary`, `category`
     * or `purposes` is an error (`SUI-BUILD-CATEGORY`, `SUI-BUILD-PURPOSES`, `SUI-BUILD-SUMMARY`). When false (the
     * default) they are accepted and the catalog entry leaves the keys out. A present value that breaks its rule and a
     * purpose phrase that repeats another component's are errors either way
     */
    requireSearchKeys?: boolean;
    /**
     * A folder of patterns, `<kind>/<name>/<name>.pattern.json` with the kind `shell` or `screen`. They are read after
     * the components are built and checked against them; each one that passes is in the catalog's `patterns`, and each
     * problem is a build error. Without it the catalog's `patterns` is empty
     */
    patternsDir?: string;
    /**
     * A folder of theme presets, `<name>.preset.json`, each a theme part (`tokens`, `overlays`) with a one-line
     * `summary`. Each one that passes the token and overlay checks is in the catalog's `themePresets`, and each problem
     * is a build error. Without it the catalog's `themePresets` is empty
     */
    presetsDir?: string;
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
    /** The content of `catalog.json`: every component that built, sorted by name, and the patterns that passed */
    catalog: Catalog;
}
