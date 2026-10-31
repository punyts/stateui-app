/** `"error"` is the default when `severity` is absent; a `"warning"` never makes a document invalid */
export type Severity = 'error' | 'warning';

/**
 * One problem found in a document, a shape or a component library. Plain and serialisable: the
 * ui-builder domain mirrors it as an interface. Messages carry paths and names only, never content or data values
 */
export interface BuildError {
    code: string;
    message: string;
    severity?: Severity;
    statePath?: string;
    component?: string;
    file?: string;
    line?: number;
    column?: number;
}

/** The placeholders a message template may use. Each one holds a path, a name or a number, never content */
export const TEMPLATE_PLACEHOLDERS = [
    'path',
    'name',
    'component',
    'key',
    'other',
    'event',
    'command',
    'target',
    'token',
    'locale',
    'file',
    'limit',
    'actual'
] as const;

export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

/** Template values plus the location fields copied onto the error */
export interface ErrorDetails extends Partial<Record<TemplatePlaceholder, string | number>> {
    statePath?: string;
    line?: number;
    column?: number;
}
