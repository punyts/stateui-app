/** The value types a token may have; the type comes from the token's place in the default tree */
export const TOKEN_TYPES = [
    'color',
    'dimension',
    'inset',
    'number',
    'duration',
    'easing',
    'shadow',
    'fontFamily',
    'fontWeight'
] as const;

export type TokenType = (typeof TOKEN_TYPES)[number];

/** The three layers a token belongs to; a reference may only point down the list (component, semantic, primitive) */
export type TokenLayer = 'primitive' | 'semantic' | 'component';

/** The token tree: nested objects whose leaves are strings, never dotted keys */
export interface TokenTree {
    [key: string]: string | TokenTree;
}

/** One leaf of a token tree */
export interface TokenLeaf {
    /** Dotted path below `tokens`, such as `color.text.muted` */
    path: string;
    /** The custom property name, such as `--ui-color-text-muted` */
    cssName: string;
    layer: TokenLayer;
    /** Absent only for a path that is neither in the default tree nor a known component token */
    type?: TokenType;
    value: string;
}

/** A component token as a shape declares it: the full dotted path starts with the group */
export interface ComponentToken {
    path: string;
    group: string;
    type: TokenType;
    default: string;
}

/** The state path of the token tree; token paths are written below it */
export const TOKENS_STATE_PATH = '$.theme.tokens';
