import { FIELD_PATTERN, FILTER_KINDS, cellText, compareSortValues, fieldValue, foldText, isSortNothing, optionLabels, passesFilters, readFilters } from './recordView.js';
import type { FilterColumn, FilterKind, SortDirection } from './recordView.js';

type Entry = Record<string, unknown>;

/** The most rows an export writes; a source with more is refused, not cut short */
export const MAX_EXPORT_ROWS = 100_000;

/** The most columns an export request names */
export const MAX_EXPORT_COLUMNS = 100;

/** The longest text an export request holds in one place: a title, a filter, an option label */
export const MAX_EXPORT_TEXT = 500;

/** The most options one column of an export request lists */
export const MAX_EXPORT_OPTIONS = 200;

/** A state path an export reads its records from: under `$.data` (the app's bindings) or `$.external` (other owners' shares) */
export const EXPORT_SOURCE_PATTERN = /^\$\.(data|external)(\.[A-Za-z_][A-Za-z0-9_-]*)+$/;

/** A file name an export is saved as: letters, digits, spaces, dots, hyphens and underscores, ending in `.csv` */
export const EXPORT_NAME_PATTERN = /^[\p{L}\p{N} ._-]{1,96}\.csv$/u;

/** One column of an export: its header and how its cells are read and filtered */
export interface ExportColumn extends FilterColumn {
    title: string;
}

/** What a grid sends to have its records exported: the visible columns in order, its filters and its sort; never rows */
export interface RecordExportRequest {
    columns: ExportColumn[];
    /** The quick filter as typed */
    filter: string;
    /** Column key to the text or option key of its filter */
    filters: Record<string, string>;
    /** The field to sort by, `''` for the records' own order */
    sortBy: string;
    sortDir: SortDirection;
}

const isEntry = (value: unknown): value is Entry => value !== null && typeof value === 'object' && !Array.isArray(value);
const shortText = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_EXPORT_TEXT;
const hasOnlyKeys = (value: Entry, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key));

function readColumn(value: unknown): ExportColumn | undefined {
    if (!isEntry(value) || !hasOnlyKeys(value, ['key', 'field', 'title', 'filter', 'options'])) return undefined;
    const { key, field, title, filter, options } = value;
    if (!shortText(key) || key === '' || typeof field !== 'string' || !FIELD_PATTERN.test(field) || field.length > MAX_EXPORT_TEXT || !shortText(title)) return undefined;
    if (filter !== undefined && !(FILTER_KINDS as readonly unknown[]).includes(filter)) return undefined;
    if (options !== undefined) {
        if (!isEntry(options) || Object.keys(options).length > MAX_EXPORT_OPTIONS) return undefined;
        if (!Object.entries(options).every(([option, label]) => option.length <= MAX_EXPORT_TEXT && shortText(label))) return undefined;
    }
    return { key, field, title, filter: (filter as FilterKind | undefined) ?? 'none', options: (options as Record<string, string> | undefined) ?? {} };
}

/**
 * Reads an export request as it arrives from a browser, or undefined when it is not one: unknown keys, a field that is
 * not a dotted name, more than `MAX_EXPORT_COLUMNS` columns or text longer than `MAX_EXPORT_TEXT` are refused
 */
export function readExportRequest(value: unknown): RecordExportRequest | undefined {
    if (!isEntry(value) || !hasOnlyKeys(value, ['columns', 'filter', 'filters', 'sortBy', 'sortDir'])) return undefined;
    const { columns, filter, filters, sortBy, sortDir } = value;
    if (!Array.isArray(columns) || columns.length === 0 || columns.length > MAX_EXPORT_COLUMNS) return undefined;
    const read = columns.map(readColumn);
    if (read.some((column) => column === undefined)) return undefined;
    if (filter !== undefined && !shortText(filter)) return undefined;
    if (filters !== undefined && (!isEntry(filters) || Object.keys(filters).length > MAX_EXPORT_COLUMNS || !Object.values(filters).every(shortText))) return undefined;
    if (sortBy !== undefined && sortBy !== '' && (typeof sortBy !== 'string' || !FIELD_PATTERN.test(sortBy) || sortBy.length > MAX_EXPORT_TEXT)) return undefined;
    if (sortDir !== undefined && sortDir !== 'asc' && sortDir !== 'desc') return undefined;
    return {
        columns: read as ExportColumn[],
        filter: (filter as string | undefined) ?? '',
        filters: readFilters(filters),
        sortBy: (sortBy as string | undefined) ?? '',
        sortDir: (sortDir as SortDirection | undefined) ?? 'asc'
    };
}

/** The export request of a grid's columns map (keyed columns with `_title`, `field`, `filter`, `options`), in key order; columns without a field are left out */
export function exportColumnsOf(columns: unknown): ExportColumn[] {
    if (!isEntry(columns)) return [];
    const read: ExportColumn[] = [];
    for (const [key, column] of Object.entries(columns)) {
        if (!isEntry(column) || typeof column['field'] !== 'string' || !FIELD_PATTERN.test(column['field'])) continue;
        const filter = (FILTER_KINDS as readonly unknown[]).includes(column['filter']) ? (column['filter'] as FilterKind) : 'none';
        read.push({ key, field: column['field'], title: typeof column['_title'] === 'string' ? column['_title'] : key, filter, options: optionLabels(column['options']) });
    }
    return read;
}

/** The outcome of an export: its rows, header first, or the reason it cannot be made */
export type RecordExport = { kind: 'rows'; rows: string[][]; count: number } | { kind: 'too-large' } | { kind: 'not-records' };

/** A text cell that a spreadsheet would read as a formula gets a leading `'`, so opening the file runs nothing */
const guarded = (cell: string): string => (/^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell);

/**
 * The rows of an export: the records (an array, or a keyed map in its key order) that pass the filters, sorted by
 * `sortBy` (stable; values that are nothing last in both directions), each as the text of the columns, with the titles
 * as the first row. A select column writes its labels; text a spreadsheet would read as a formula is guarded
 */
export function exportRecords(records: unknown, request: RecordExportRequest): RecordExport {
    const list = Array.isArray(records) ? records : isEntry(records) ? Object.values(records) : undefined;
    if (list === undefined) return { kind: 'not-records' };
    const quick = foldText(request.filter.trim());
    const kept = list.filter((record) => isEntry(record) && passesFilters(record, request.columns, quick, request.filters));
    if (kept.length > MAX_EXPORT_ROWS) return { kind: 'too-large' };
    if (request.sortBy !== '') {
        const sign = request.sortDir === 'desc' ? -1 : 1;
        const entries = kept.map((record, index) => ({ record, index, value: fieldValue(record, request.sortBy) }));
        entries.sort((a, b) => {
            const aNothing = isSortNothing(a.value);
            if (aNothing !== isSortNothing(b.value)) return aNothing ? 1 : -1;
            return compareSortValues(a.value, b.value) * sign || a.index - b.index;
        });
        kept.splice(0, kept.length, ...entries.map((entry) => entry.record));
    }
    const rows = [request.columns.map((column) => guarded(column.title))];
    for (const record of kept) {
        rows.push(
            request.columns.map((column) => {
                const value = fieldValue(record, column.field);
                const cell = cellText(value, column.options);
                return typeof value === 'string' ? guarded(cell) : cell;
            })
        );
    }
    return { kind: 'rows', rows, count: kept.length };
}

/** Rows as CSV (RFC 4180): fields with a comma, quote or line break are quoted, quotes doubled, lines end in CRLF */
export function toCsv(rows: readonly (readonly string[])[]): string {
    const field = (cell: string): string => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
    return rows.map((row) => row.map(field).join(',')).join('\r\n') + '\r\n';
}
