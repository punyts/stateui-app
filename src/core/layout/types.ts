/** The type and allowed values of one layout setting or placement field */
export type FieldSpec =
    | { type: 'enum'; values: readonly string[] }
    | { type: 'boolean' }
    | { type: 'integer'; min: number; max: number }
    | { type: 'number'; min: number; max: number }
    /** A literal dimension (`4px`, `1.5rem`, `50%`, `0`): no `calc()` and no token reference */
    | { type: 'dimension' };

/** One layout type: the settings its container may carry and the placement fields its children may carry */
export interface LayoutDefinition {
    settings: Readonly<Record<string, FieldSpec>>;
    placement: Readonly<Record<string, FieldSpec>>;
}
