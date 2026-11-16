import { isObject } from '../resolve/merge.js';
import type { JsonObject, JsonValue } from '../types.js';
import { condition } from './values.js';
import type { Scope } from './values.js';

/**
 * A query over a map of records, as the logic `query` command takes it once its values are resolved: `filter` is an
 * expression that sees `$record` and `$key`; `sort` is a field name (`-name` for descending) or `{ by, direction }`;
 * `window` is `{ first, count }`
 */
export interface RecordQuery {
    readonly filter?: string;
    readonly sort?: JsonValue;
    readonly window?: JsonValue;
}

/** The records of one window, as `[key, record]` in query order, with the index of the first and the count before windowing */
export interface RecordQueryResult {
    readonly rows: readonly (readonly [string, JsonValue])[];
    readonly first: number;
    readonly total: number;
}

function readSort(sort: JsonValue | undefined): { by: string; descending: boolean } | undefined {
    if (typeof sort === 'string' && sort !== '') {
        return sort.startsWith('-') ? { by: sort.slice(1), descending: true } : { by: sort, descending: false };
    }
    if (isObject(sort) && typeof sort['by'] === 'string' && sort['by'] !== '') {
        return { by: sort['by'], descending: sort['direction'] === 'desc' };
    }
    return undefined;
}

/** Numbers by value, missing and null last, anything else as text with numbers in it compared as numbers */
function compare(a: JsonValue | undefined, b: JsonValue | undefined): number {
    if (a === b) return 0;
    if (a === undefined || a === null) return 1;
    if (b === undefined || b === null) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function readWindow(window: JsonValue | undefined, total: number): { first: number; count: number } {
    const first = isObject(window) && typeof window['first'] === 'number' ? Math.max(0, Math.floor(window['first'])) : 0;
    const count = isObject(window) && typeof window['count'] === 'number' ? Math.max(0, Math.floor(window['count'])) : total;
    return { first, count };
}

const NO_STATE: Scope = { read: () => undefined, captures: {} };

/**
 * Filters, sorts and windows a map of records: the evaluator of the logic `query` command, for a caller outside the
 * logic engine too (the server's dataset queries). `scope` is what the filter can read besides `$record` and `$key`;
 * without it the filter sees only those. A filter that does not evaluate throws a `LogicError`. The sort is stable, so
 * records that compare equal keep their map order
 */
export function queryRecords(records: Readonly<JsonObject>, query: RecordQuery, scope: Scope = NO_STATE): RecordQueryResult {
    let rows = Object.entries(records) as [string, JsonValue][];
    const filter = query.filter;
    if (filter !== undefined) rows = rows.filter(([key, record]) => condition(filter, { ...scope, key, record }));
    const sort = readSort(query.sort);
    if (sort) {
        rows.sort(([, a], [, b]) => {
            const order = compare(isObject(a) ? a[sort.by] : undefined, isObject(b) ? b[sort.by] : undefined);
            return sort.descending ? -order : order;
        });
    }
    const window = readWindow(query.window, rows.length);
    return { rows: rows.slice(window.first, window.first + window.count), first: window.first, total: rows.length };
}
