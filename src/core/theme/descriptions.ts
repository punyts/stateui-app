import descriptions from './tokens.descriptions.json' with { type: 'json' };

/** The file the descriptions are read from, for messages */
export const TOKEN_DESCRIPTIONS_FILE = 'tokens.descriptions.json';

/** One-line descriptions of the semantic tokens, by dotted path, kept beside `tokens.default.json` */
export const DEFAULT_TOKEN_DESCRIPTIONS: Readonly<Record<string, string>> = descriptions;
