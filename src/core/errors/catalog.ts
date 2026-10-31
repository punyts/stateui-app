import type { Severity } from './types.js';

/** The code families. `SUI-LAYOUT` has no sub-codes yet; epic 3 adds the ones it needs */
export const ERROR_PREFIXES = [
    'SUI-DOC',
    'SUI-NODE',
    'SUI-STATE',
    'SUI-LINK',
    'SUI-ON',
    'SUI-LAYOUT',
    'SUI-THEME',
    'SUI-LOCALE',
    'SUI-BUILD',
    'SUI-RUN'
] as const;

export interface CatalogEntry {
    /** Message text with `{placeholder}` markers, see TEMPLATE_PLACEHOLDERS */
    template: string;
    /** Absent means `"error"` */
    severity?: Severity;
}

/** Every stable code and the message template the catalog owns for it */
export const ERROR_CATALOG = {
    'SUI-DOC-SHAPE': { template: 'The document is not a valid application document' },
    'SUI-DOC-KEY': { template: 'Unknown or misplaced document key "{key}" at {path}' },
    'SUI-DOC-ORDER': { template: 'Key "{key}" at {path} is integer-like and would be reordered; use a prefixed key' },
    'SUI-DOC-LIMIT-NODES': { template: 'The document has {actual} nodes; the limit is {limit}' },
    'SUI-DOC-LIMIT-DEPTH': { template: 'Nodes nest {actual} levels deep at {path}; the limit is {limit}' },
    'SUI-DOC-LIMIT-BYTES': { template: 'The document is {actual} bytes; the limit is {limit}' },
    'SUI-DOC-LIMIT-DATA': { template: 'The data branch is {actual} bytes; the limit is {limit}' },
    'SUI-NODE-UNKNOWN': { template: 'Unknown component "{component}" at {path}' },
    'SUI-NODE-CYCLE': { template: 'Composed component "{component}" contains itself at {path}' },
    'SUI-NODE-MISSING': { template: 'No node at {path}' },
    'SUI-NODE-NAME': { template: 'Property name "{name}" at {path} is not allowed' },
    'SUI-STATE-INVALID': { template: 'Property "{name}" at {path} does not fit the shape of "{component}"' },
    'SUI-STATE-UNKNOWN': { template: 'Property "{name}" at {path} is not in the shape of "{component}"' },
    'SUI-STATE-REQUIRED': { template: 'Property "{name}" at {path} is required by "{component}"' },
    'SUI-LINK-MISSING': { template: 'Link target {target} at {path} does not exist' },
    'SUI-LINK-CYCLE': { template: 'Link at {path} loops back through {target}' },
    'SUI-ON-EVENT': { template: 'Component "{component}" at {path} has no event "{event}"' },
    'SUI-ON-COMMAND': { template: 'Component "{component}" at {path} has no command "{command}"' },
    'SUI-ON-TARGET': { template: 'Target {target} of "{event}" at {path} does not resolve' },
    'SUI-THEME-NAME': { template: 'Token name "{name}" at {path} collides with another token after flattening' },
    'SUI-THEME-OVERLAY': { template: 'Theme overlay "{name}" of kind "{other}" sets a token group outside its kind at {path}' },
    'SUI-THEME-CONTRAST': {
        template: 'Contrast between {token} and {other} is {actual}:1, below {limit}:1',
        severity: 'warning'
    },
    'SUI-LOCALE-CONTENT': { template: 'Overlay "{locale}" sets non-content property "{name}" at {path}' },
    'SUI-LOCALE-PATH': { template: 'Overlay "{locale}" has a path that does not exist: {path}' },
    'SUI-LOCALE-MISSING': { template: 'Language "{locale}" does not translate {path}', severity: 'warning' },
    'SUI-BUILD-SHAPE': { template: 'Invalid shape file {file}: {name}' },
    'SUI-BUILD-NAME': { template: 'Name "{name}" in {file} is not allowed' },
    'SUI-BUILD-TOKEN': { template: 'CSS in {file} uses "{token}"; components may only use semantic and component tokens' },
    'SUI-RUN-UNRESPONSIVE': { template: 'The preview did not answer the heartbeat' },
    'SUI-RUN-BINDING': { template: 'Binding or controller of "{component}" failed at {path}' }
} as const satisfies Record<string, CatalogEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;
