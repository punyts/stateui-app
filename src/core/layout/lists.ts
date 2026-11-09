import type { FieldSpec, LayoutDefinition } from './types.js';

/** The closed list of layout types */
export const LAYOUT_TYPES = ['column', 'row', 'grid', 'region', 'adhoc'] as const;

export type LayoutType = (typeof LAYOUT_TYPES)[number];

/** The `space.gap` tokens a `gap` setting names */
export const GAPS = ['none', 'sm', 'md', 'lg'] as const;

export const ALIGNS = ['start', 'center', 'end', 'stretch'] as const;

/** The container widths a `collapseBelow` setting names */
export const COLLAPSE_BELOW = ['sm', 'md', 'lg', 'xl'] as const;

/** The areas of a `region` layout */
export const REGIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'center'] as const;

const GAP: FieldSpec = { type: 'enum', values: GAPS };
const ALIGN: FieldSpec = { type: 'enum', values: ALIGNS };
const WRAP: FieldSpec = { type: 'boolean' };
const COUNT: FieldSpec = { type: 'integer', min: 1, max: 12 };
const COLLAPSE: FieldSpec = { type: 'enum', values: COLLAPSE_BELOW };
const GROW: FieldSpec = { type: 'number', min: 0, max: 12 };
const LENGTH: FieldSpec = { type: 'dimension' };
/** The height of a child of a column, row or grid: what a record view or an `adhoc` area needs, since neither has one of its own */
const HEIGHT: FieldSpec = { type: 'size' };
/** The stacking order of an `adhoc` child: a higher `z` is drawn over a lower one */
const STACK: FieldSpec = { type: 'integer', min: 0, max: 999 };

/** Each layout type with its container settings and child placement fields */
export const LAYOUTS: Readonly<Record<LayoutType, LayoutDefinition>> = {
    column: { settings: { gap: GAP, align: ALIGN }, placement: { grow: GROW, height: HEIGHT } },
    row: { settings: { gap: GAP, align: ALIGN, wrap: WRAP, collapseBelow: COLLAPSE }, placement: { grow: GROW, height: HEIGHT } },
    grid: {
        settings: { cols: COUNT, rows: COUNT, gap: GAP, collapseBelow: COLLAPSE },
        placement: { col: COUNT, row: COUNT, span: COUNT, rowSpan: COUNT, height: HEIGHT }
    },
    region: { settings: { gap: GAP, collapseBelow: COLLAPSE }, placement: { region: { type: 'enum', values: REGIONS } } },
    adhoc: { settings: { clip: WRAP }, placement: { x: LENGTH, y: LENGTH, width: LENGTH, height: LENGTH, z: STACK } }
};

/** True when the name is one of the layout types */
export function isLayoutType(name: unknown): name is LayoutType {
    return typeof name === 'string' && (LAYOUT_TYPES as readonly string[]).includes(name);
}
