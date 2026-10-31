import { buildError } from '../../core/errors/index.js';
import type { BuildError } from '../../core/errors/index.js';
import { DEFAULT_LEAVES, toCssValue } from '../../core/theme/index.js';
import type { ComponentToken } from '../../core/theme/index.js';
import type { CssCheck, CssContext } from '../types.js';
import { declarationsOf, locator, maskCss } from './mask.js';
import { findUiVars, squash } from './vars.js';

const PRIMITIVE_GROUPS: readonly string[] = ['palette', 'scale', 'font'];
const HEX_COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g;
const FUNCTION_COLOR = /(?<![a-zA-Z0-9_-])(?:rgba?|hsla?)\(/gi;

const DEFAULT_NAMES = new Set(DEFAULT_LEAVES.map((leaf) => leaf.cssName));
const SEMANTIC_DEFAULTS = new Map(
    DEFAULT_LEAVES.filter((leaf) => leaf.layer === 'semantic').map((leaf) => [leaf.cssName, squash(toCssValue(leaf.value))])
);

/** What the lint needs to know besides the CSS text */
export type LintContext = Pick<CssContext, 'file' | 'tokens'>;

function componentDefaults(tokens: readonly ComponentToken[]): Map<string, string> {
    return new Map(tokens.map((token) => [`--ui-${token.path.split('.').join('-')}`, squash(toCssValue(token.default))]));
}

/**
 * Checks CSS text against the token rules: only semantic and component tokens (`var(--ui-palette-*)`,
 * `var(--ui-scale-*)` and any `var(--ui-font-*)` are primitives), no `var(--ui-*)` name that is neither a default token
 * nor a declared component token, no literal colour (`#hex`, `rgb(`, `rgba(`, `hsl(`, `hsla(`), and a fallback written
 * by hand on a declared component token must equal the shape default. Comments, strings and `url()` contents are
 * ignored. Every error is a `SUI-BUILD-TOKEN` with the 1-based line and column of the offending name or colour.
 *
 * One declaration is exempt: a custom property that is a default semantic token, written with that token's own default
 * expression. The generated shared sheet uses it to re-declare the density-dependent tokens on a density host
 */
export function lintCss(css: string, context: LintContext): BuildError[] {
    const masked = maskCss(css);
    const where = locator(css);
    const declared = componentDefaults(context.tokens);
    const declarations = declarationsOf(masked);
    const exempt = declarations.filter(
        (declaration) => SEMANTIC_DEFAULTS.get(declaration.property) === squash(masked.slice(declaration.valueStart, declaration.end))
    );
    const isExempt = (offset: number): boolean => exempt.some((declaration) => offset >= declaration.valueStart && offset < declaration.end);

    const found: { offset: number; token: string; reason: string }[] = [];
    for (const variable of findUiVars(masked)) {
        if (isExempt(variable.nameOffset)) continue;
        const group = variable.name.slice('--ui-'.length).split('-')[0] as string;
        const fallback = declared.get(variable.name);
        let reason: string | undefined;
        if (PRIMITIVE_GROUPS.includes(group)) reason = 'primitive tokens are not allowed; use a semantic or component token';
        else if (fallback !== undefined) {
            if (variable.fallback !== undefined && squash(variable.fallback) !== fallback) {
                reason = 'the fallback differs from the default in the shape';
            }
        } else if (!DEFAULT_NAMES.has(variable.name)) reason = 'not a default token or a declared component token';
        if (reason !== undefined) found.push({ offset: variable.nameOffset, token: variable.name, reason });
    }
    for (const declaration of declarations) {
        if (exempt.includes(declaration)) continue;
        const value = masked.slice(declaration.valueStart, declaration.end);
        for (const pattern of [HEX_COLOR, FUNCTION_COLOR]) {
            for (const match of value.matchAll(pattern)) {
                found.push({
                    offset: declaration.valueStart + (match.index ?? 0),
                    token: match[0],
                    reason: 'literal colours are not allowed; use a semantic or component token'
                });
            }
        }
    }

    return found
        .sort((a, b) => a.offset - b.offset)
        .map((entry) => buildError('SUI-BUILD-TOKEN', { file: context.file, token: entry.token, name: entry.reason, ...where(entry.offset) }));
}

/** The `cssChecks` entry the build always runs: `lintCss` on the component's CSS as written */
export const checkTokens: CssCheck = (css, context) => lintCss(css, context);
