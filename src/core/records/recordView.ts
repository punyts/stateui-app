/**
 * How a grid's records are filtered and sorted, the same in the browser (the `table` component) and on the authority
 * (a CSV export), so an export holds exactly the rows the grid shows. DOM-free and Node-free
 */

type Entry = Record<string, unknown>;

/** The filters a column can show in a grid's filter row */
export const FILTER_KINDS = ['none', 'text', 'select'] as const;

export type FilterKind = (typeof FILTER_KINDS)[number];

/** The directions records sort in */
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** A dotted record field: `name`, `address.city` */
export const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

const isEntry = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A column as filtering sees it: its key, the record field it shows, its filter and a select column's labels by key */
export interface FilterColumn {
    key: string;
    field: string;
    filter: FilterKind;
    options: Record<string, string>;
}

/** The value at a dotted field of a record, or undefined */
export function fieldValue(record: unknown, field: string): unknown {
    let value: unknown = record;
    for (const segment of field.split('.')) {
        if (value === null || typeof value !== 'object') return undefined;
        value = (value as Entry)[segment];
    }
    return value;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Numbers and booleans sort as numbers, before text; nothing (`undefined`, `null`, `''`, `NaN`) is ranked last */
const rank = (value: unknown): number => {
    if (typeof value === 'number') return Number.isNaN(value) ? 2 : 0;
    if (typeof value === 'boolean') return 0;
    if (typeof value === 'string') return value === '' ? 2 : 1;
    return value === undefined || value === null ? 2 : 1;
};

/**
 * Compares two field values for an ascending sort: numbers and booleans by value, then text with a numeric, case- and
 * accent-insensitive collation (`a2` before `a10`); anything else is compared as its text
 */
export function compareSortValues(a: unknown, b: unknown): number {
    const left = rank(a);
    const right = rank(b);
    if (left !== right) return left - right;
    if (left === 2) return 0;
    if (left === 0) return Number(a) - Number(b);
    return collator.compare(String(a), String(b));
}

/** Whether a value is nothing for a sort: such values stay last in both directions */
export const isSortNothing = (value: unknown): boolean => rank(value) === 2;

/** A column's `options` as labels by key; an option without a `_label` is labelled by its key */
export function optionLabels(options: unknown): Record<string, string> {
    const labels: Record<string, string> = {};
    if (!isEntry(options)) return labels;
    for (const [option, entry] of Object.entries(options)) {
        const label = isEntry(entry) ? text(entry['_label']) : '';
        labels[option] = label === '' ? option : label;
    }
    return labels;
}

/** The per-column filters that hold a value: column key to the text or option key typed or chosen */
export function readFilters(value: unknown): Record<string, string> {
    const filters: Record<string, string> = {};
    if (!isEntry(value)) return filters;
    for (const [key, wanted] of Object.entries(value)) if (typeof wanted === 'string' && wanted.trim() !== '') filters[key] = wanted;
    return filters;
}

/** Text folded for a search that ignores case and accents */
export const foldText = (value: string): string => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();

/** The text a value is searched and exported as: a select column's label for its key, numbers and booleans as text, nothing for anything else */
export const cellText = (value: unknown, options: Readonly<Record<string, string>>): string => {
    if (typeof value === 'string') return options[value] ?? value;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    return typeof value === 'boolean' ? String(value) : '';
};

/**
 * Whether a record passes the filters. The quick filter (already folded and trimmed) passes a record when any column's
 * text holds it; a `text` filter when its column's text holds the filter text; a `select` filter when the field holds
 * the option key. A filter on a column that is not listed, or that has no filter, is ignored
 */
export function passesFilters(record: unknown, columns: readonly FilterColumn[], quick: string, filters: Readonly<Record<string, string>>): boolean {
    if (quick !== '' && !columns.some((column) => foldText(cellText(fieldValue(record, column.field), column.options)).includes(quick))) return false;
    for (const [key, wanted] of Object.entries(filters)) {
        const column = columns.find((candidate) => candidate.key === key);
        if (column === undefined || column.filter === 'none') continue;
        const value = fieldValue(record, column.field);
        if (column.filter === 'select' ? String(value ?? '') !== wanted : !foldText(cellText(value, column.options)).includes(foldText(wanted.trim()))) return false;
    }
    return true;
}
