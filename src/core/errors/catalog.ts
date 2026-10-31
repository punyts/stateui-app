import type { Severity } from './types.js';

/** The code families */
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
    'SUI-DOC-COMPOSED': { template: 'Composed component "{name}" at {path} uses a reserved library name' },
    'SUI-DOC-EXPOSES': { template: 'Exposed path "{key}" of a composed entry {name}' },
    'SUI-DOC-TYPE': { template: 'Document key "{key}" at {path} has the wrong type' },
    'SUI-DOC-VALIDATOR': { template: 'Validator "{name}" failed while checking the document' },
    'SUI-DOC-ORDER': { template: 'Key "{key}" at {path} is integer-like and would be reordered; use a prefixed key' },
    'SUI-DOC-LIMIT-NODES': { template: 'The document has {actual} nodes; the limit is {limit}' },
    'SUI-DOC-LIMIT-DEPTH': { template: 'Nodes nest {actual} levels deep at {path}; the limit is {limit}' },
    'SUI-DOC-LIMIT-BYTES': { template: 'The document is {actual} bytes; the limit is {limit}' },
    'SUI-DOC-LIMIT-DATA': { template: 'The data branch is {actual} bytes; the limit is {limit}' },
    'SUI-NODE-UNKNOWN': { template: 'Unknown component "{component}" at {path}' },
    'SUI-NODE-CYCLE': { template: 'Composed component "{component}" contains itself at {path}' },
    'SUI-NODE-MISSING': { template: 'No node at {path}' },
    'SUI-NODE-CHILD': { template: 'Component "{component}" at {path} is not accepted by its parent slot; it takes {other}' },
    'SUI-NODE-NAME': { template: 'Property name "{name}" at {path} is not allowed' },
    'SUI-STATE-INVALID': { template: 'Property "{name}" at {path} does not fit the shape of "{component}"' },
    'SUI-STATE-UNKNOWN': { template: 'Property "{name}" at {path} is not in the shape of "{component}"' },
    'SUI-STATE-SHARED': {
        template: 'Property "{name}" at {path} is a shared property "{component}" does not support; it supports {other}'
    },
    'SUI-STATE-REQUIRED': { template: 'Property "{name}" at {path} is required by "{component}"' },
    'SUI-STATE-CONDITION': {
        template: 'Property "{name}" at {path} is required by "{component}" under the value of "{other}"'
    },
    'SUI-STATE-RUNTIME': {
        template: 'Property "{name}" at {path} is written by the controller of "{component}"; a node cannot set it'
    },
    'SUI-STATE-FILLED': {
        template: 'Property "{name}" at {path} asks for a filled icon, but "{other}" has no filled variant; the outline is drawn',
        severity: 'warning'
    },
    'SUI-LINK-ROW': { template: 'Reference {target} at {path} uses $row outside a row template' },
    'SUI-LINK-MISSING': {
        template: 'Link target {target} at {path} does not exist or is not an exposed runtime property'
    },
    'SUI-LINK-TARGET': {
        template: 'Link "{key}" at {path} has target {target}; it must start with $.data or $row, or be a node reference (^name.path or .path)'
    },
    'SUI-LINK-CYCLE': { template: 'Link at {path} loops back through {target}' },
    'SUI-ON-EVENT': { template: 'Component "{component}" at {path} has no event "{event}"' },
    'SUI-ON-COMMAND': { template: 'Component "{component}" at {path} has no command "{command}"' },
    'SUI-ON-VALUE': { template: 'The value of command "{command}" at {path} is not a key of "{name}"' },
    'SUI-ON-SHAPE':{ template: '"on" entry at {path} must be one command object or a list of them' },
    'SUI-ON-TARGET': { template: 'Target {target} of "{event}" at {path} does not resolve' },
    'SUI-THEME-NAME': { template: 'Token name "{name}" at {path} must be lower-case letters and digits' },
    'SUI-THEME-REF': { template: 'Token at {path} has the reference {target}, which is not allowed: {name}' },
    'SUI-THEME-VALUE': { template: 'Token value at {path} is not a valid "{name}" value' },
    'SUI-THEME-TOKEN': { template: 'Token path {path} is not in the default tree or the component tokens' },
    'SUI-THEME-LAYER': {
        template: 'Token "{name}" at {path} is a primitive token; node "{component}" at {other} may override semantic and component tokens only'
    },
    'SUI-THEME-OVERLAY': { template: 'Theme overlay "{name}" of kind "{other}" at {path} is not allowed: {key}' },
    'SUI-THEME-CONTRAST': {
        template: 'Contrast between {token} and {other} is {actual}:1, below {limit}:1',
        severity: 'warning'
    },
    'SUI-LOCALE-CONTENT': { template: 'Overlay "{locale}" sets non-content property "{name}" at {path}' },
    'SUI-LOCALE-PATH': { template: 'Overlay "{locale}" has a path that does not exist: {path}' },
    'SUI-LAYOUT-SHAPE': { template: 'The layout or placement at {path} is not an object' },
    'SUI-LAYOUT-TYPE': { template: 'The layout at {path} has an unknown or missing type' },
    'SUI-LAYOUT-SETTING': { template: 'Unknown layout setting "{name}" at {path}' },
    'SUI-LAYOUT-VALUE': { template: 'Layout setting "{name}" at {path} has a value that is not allowed' },
    'SUI-LAYOUT-UNSUPPORTED': { template: 'Component "{component}" at {path} does not support a layout' },
    'SUI-LAYOUT-FIELD': {
        template: 'Placement field "{name}" at {path} does not fit the layout or placement shape of the parent'
    },
    'SUI-LAYOUT-PLACEMENT': { template: 'Placement field "{name}" at {path} has a value that is not allowed' },
    'SUI-LAYOUT-REQUIRED': { template: 'Placement field "{name}" is required at {path}' },
    'SUI-LAYOUT-PARENT': {
        template: 'Placement at {path} sits under "{name}" at {other}, which has neither a layout nor a placement shape'
    },
    'SUI-LAYOUT-ROOT': { template: 'The root node at {path} has a placement but no parent' },
    'SUI-LOCALE-MORE': {
        template: 'Language "{locale}" has {actual} more untranslated content paths; {limit} are listed',
        severity: 'warning'
    },
    'SUI-LOCALE-UNKNOWN': { template: 'No overlay for language "{locale}"' },
    'SUI-LOCALE-LINKED': { template: 'Overlay "{locale}" sets linked property "{name}" at {path}' },
    'SUI-LOCALE-MISSING': { template: 'Language "{locale}" does not translate {path}', severity: 'warning' },
    'SUI-BUILD-SHAPE': { template: 'Invalid shape file {file}: {name}' },
    'SUI-BUILD-EXPOSES': { template: 'Exposed path "{key}" in {file} {name}' },
    'SUI-BUILD-NAME': { template: 'Name "{name}" in {file} is not allowed' },
    'SUI-BUILD-KEY': { template: 'Unknown key "{key}" at {path} in {file}' },
    'SUI-BUILD-VALIDATOR': { template: 'Unknown validator "{name}" on property "{key}" in {file}' },
    'SUI-BUILD-KIND': {
        template: 'Property "{name}" in {file} must have kind "content" exactly when its name starts with "_"'
    },
    'SUI-BUILD-DEFAULT': {
        template: 'Default of property "{name}" in {file} does not fit its type, allowed values or validators'
    },
    'SUI-BUILD-PATTERN': {
        template: 'Pattern of property "{name}" in {file} is not a valid expression or is over {limit} characters'
    },
    'SUI-BUILD-SUMMARY': { template: 'Shape {file} needs a one-line "summary" of at most {limit} characters' },
    'SUI-BUILD-FILE': { template: 'File {file} is not inside a component folder' },
    'SUI-BUILD-ROLE': { template: 'File {file} must be named "{name}.<role>" with a known role' },
    'SUI-BUILD-DUPLICATE': { template: 'Component "{component}" is defined by both {file} and {other}' },
    'SUI-BUILD-TIER': { template: 'Component "{component}" in {file} mixes root and composed files' },
    'SUI-BUILD-MISSING': { template: 'Root component "{component}" in {file} needs {name}' },
    'SUI-BUILD-TEMPLATE': { template: 'Template {file} does not compile: {name}' },
    'SUI-BUILD-STYLE': { template: 'Styles in {file} do not compile: {name}' },
    'SUI-BUILD-CONTROLLER': { template: 'Controller {file} is not valid: {name}' },
    'SUI-BUILD-IO': { template: 'File {file} could not be read: {name}' },
    'SUI-BUILD-GROUP': {
        template: 'Component "{component}" in {file} must sit in an atoms, molecules or composites folder'
    },
    'SUI-BUILD-TOKEN': { template: 'CSS in {file} uses "{token}": {name}' },
    'SUI-BUILD-TOKENGROUP': {
        template:
            'Component "{component}" in {file} needs a "tokenGroup": a lower-case word that is not a default token group'
    },
    'SUI-BUILD-TOKENDEF': { template: 'Component token "{name}" in {file} is not allowed: {other}' },
    'SUI-BUILD-TOKENCONFLICT': {
        template: 'Component token group "{name}" in {file} does not match the same group in {other}'
    },
    'SUI-BUILD-TOKENDESC': { template: 'Semantic token "{name}" needs a one-line description in {file}' },
    'SUI-RUN-UNRESPONSIVE': { template: 'The preview did not answer the heartbeat' },
    'SUI-RUN-ON-SHAPE': { template: 'The "{event}" entry at {path} is not a command or a list of commands' },
    'SUI-RUN-ON-COMMAND': { template: 'Command "{command}" for event "{event}" failed at {path}' },
    'SUI-RUN-ON-TARGET': { template: 'Target "{target}" of event "{event}" does not resolve at {path}' },
    'SUI-RUN-ICON': { template: 'Icon "{name}" at {path} is in neither the core set nor the icons of the app' },
    'SUI-RUN-BINDING': { template: 'Binding or controller of "{component}" failed at {path}' },
    'SUI-RUN-WRITE': { template: 'The runtime did not apply the write to {path}' }
} as const satisfies Record<string, CatalogEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;
