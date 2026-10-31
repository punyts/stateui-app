import { buildError } from '../core/errors/index.js';
import type { BuildError } from '../core/errors/index.js';
import {
    DEFAULT_TOKENS,
    DEFAULT_TOKEN_DESCRIPTIONS,
    KIND_GROUPS,
    OVERLAY_KINDS,
    SHIPPED_OVERLAYS,
    TOKEN_DESCRIPTIONS_FILE,
    flattenTokens
} from '../core/theme/index.js';
import type { OverlayKind, ThemeOverlays, TokenTree, TokenType } from '../core/theme/index.js';

/** One semantic token of the catalog: what a node's `theme` override may set */
export interface ThemeTokenEntry {
    /** Dotted path below `tokens`, such as `color.text.muted` */
    path: string;
    type: TokenType;
    /** The value in the `light` mode and `default` brand; a reference stays as `{path}` */
    default: string;
    /** The first segment of the path */
    group: string;
    /** One line */
    description: string;
}

/** A shipped overlay and the token groups its kind may touch */
export interface ThemeOverlayEntry {
    name: string;
    groups: string[];
}

/** The `theme` section of `catalog.json` */
export interface ThemeSection {
    /** Every semantic token, in tree order; primitive tokens (`palette`, `scale`, `font`) are left out */
    tokens: ThemeTokenEntry[];
    /** The shipped overlays by kind */
    overlays: Record<OverlayKind, ThemeOverlayEntry[]>;
}

/** Where the descriptions of the tokens come from, and the tree and overlays they describe; the defaults are the library's own */
export interface ThemeSources {
    tree?: TokenTree;
    descriptions?: Readonly<Record<string, string>>;
    overlays?: ThemeOverlays;
}

function isOneLine(text: string | undefined): text is string {
    return text !== undefined && text.trim() !== '' && !/[\r\n]/.test(text);
}

/**
 * Builds the `theme` section of the catalog from the default token tree (flattened with `flattenTokens`), the
 * descriptions kept beside it and the shipped overlays. A semantic token without a one-line description is a
 * `SUI-BUILD-TOKENDESC` error and is left out of the section
 */
export function buildThemeSection(sources: ThemeSources = {}): { theme: ThemeSection; errors: BuildError[] } {
    const descriptions = sources.descriptions ?? DEFAULT_TOKEN_DESCRIPTIONS;
    const shipped = sources.overlays ?? SHIPPED_OVERLAYS;
    const errors: BuildError[] = [];
    const tokens: ThemeTokenEntry[] = [];
    for (const leaf of flattenTokens(sources.tree ?? DEFAULT_TOKENS)) {
        if (leaf.layer !== 'semantic' || leaf.type === undefined) continue;
        const description = Object.hasOwn(descriptions, leaf.path) ? descriptions[leaf.path] : undefined;
        if (!isOneLine(description)) {
            errors.push(buildError('SUI-BUILD-TOKENDESC', { name: leaf.path, file: TOKEN_DESCRIPTIONS_FILE }));
            continue;
        }
        tokens.push({ path: leaf.path, type: leaf.type, default: leaf.value, group: leaf.path.split('.')[0] as string, description });
    }
    const overlays = {} as Record<OverlayKind, ThemeOverlayEntry[]>;
    for (const kind of OVERLAY_KINDS) {
        const names = Object.keys(Object.hasOwn(shipped, kind) ? (shipped[kind] as object) : {});
        overlays[kind] = names.map((name) => ({ name, groups: [...KIND_GROUPS[kind]] }));
    }
    return { theme: { tokens, overlays }, errors };
}
