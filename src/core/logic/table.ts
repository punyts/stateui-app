import { isObject } from '../resolve/merge.js';
import type { JsonObject, JsonValue } from '../types.js';
import type { LogicTable, LogicTableInput, LogicTableRow } from './types.js';

/** The most cells a table is compiled into; a larger table matches its rows in order at run time */
export const MAX_TABLE_CELLS = 4096;

/** The value of `values` that stands for every value the list does not name */
export const OTHER_VALUE = '*';

/** A key input of a table: its finite values, which make it one dimension of the cells */
export interface TableColumn {
    readonly name: string;
    /** The listed values (without `*`), or the breaks between number buckets */
    readonly values?: readonly JsonValue[];
    readonly breaks?: readonly number[];
    /** True when `*` stands for the values the list does not name; its index is the last */
    readonly other: boolean;
    /** The number of indexes: listed values (+1 with `*`), or breaks + 1 */
    readonly count: number;
}

export interface CompiledRow {
    /** For each column, which of its indexes the row matches */
    readonly matches: readonly (readonly boolean[])[];
    /** The output names to their values (literals or templates), as written */
    readonly outputs: Readonly<JsonObject>;
}

/** A table ready to look up: its columns, its rows and, unless it is too large, the row that wins each cell */
export interface CompiledTable {
    readonly columns: readonly TableColumn[];
    readonly rows: readonly CompiledRow[];
    /** The number of cells: the product of the columns' counts */
    readonly size: number;
    /** The winning row of each cell, -1 for a gap; absent above `MAX_TABLE_CELLS` */
    readonly cells?: Int32Array;
}

/** A problem of a table's rows, with the path below the table it is at (`rows.2.total`) */
export interface TableProblem {
    readonly at: string;
    readonly code: 'shape' | 'gap' | 'unreachable' | 'size';
    readonly message: string;
}

/** The index of a value in a column: a number, `missing` for no value (undefined or null), `outside` for a value it does not list */
export type ColumnIndex = number | 'missing' | 'outside';

const COMPARISON = /^(>=|<)\s*(-?\d+(?:\.\d+)?)$/;

function key(value: JsonValue): string {
    return JSON.stringify(value);
}

/** The input written as a path only (`"$.data.x"`), or the input object */
export function inputObject(input: LogicTableInput | string): LogicTableInput {
    return typeof input === 'string' ? { path: input } : input;
}

/** True when an input is a key input: it gives `values` or `breaks` */
export function isKeyInput(input: LogicTableInput | string): boolean {
    const object = inputObject(input);
    return object.values !== undefined || object.breaks !== undefined;
}

/** The columns of a table: its key inputs in input order, with `values` given as a list (rows from data resolve `keys` first) */
export function tableColumns(inputs: Readonly<Record<string, LogicTableInput | string>>, keyValues: (name: string) => readonly JsonValue[] | undefined = () => undefined): TableColumn[] {
    const columns: TableColumn[] = [];
    for (const [name, raw] of Object.entries(inputs)) {
        const input = inputObject(raw);
        if (input.breaks !== undefined) {
            columns.push({ name, breaks: input.breaks, other: false, count: input.breaks.length + 1 });
        } else if (input.values !== undefined) {
            const list = Array.isArray(input.values) ? input.values : (keyValues(name) ?? []);
            const listed = list.filter((value) => value !== OTHER_VALUE);
            const other = list.includes(OTHER_VALUE);
            columns.push({ name, values: listed, other, count: listed.length + (other ? 1 : 0) });
        }
    }
    return columns;
}

/** The index of a value in a column */
export function columnIndex(column: TableColumn, value: JsonValue | undefined): ColumnIndex {
    if (value === undefined || value === null) return 'missing';
    if (column.breaks) {
        if (typeof value !== 'number' || !Number.isFinite(value)) return 'outside';
        let low = 0;
        let high = column.breaks.length;
        // the number of breaks at or below the value
        while (low < high) {
            const middle = (low + high) >> 1;
            if ((column.breaks[middle] as number) <= value) low = middle + 1;
            else high = middle;
        }
        return low;
    }
    const wanted = key(value);
    const found = (column.values ?? []).findIndex((item) => key(item) === wanted);
    if (found >= 0) return found;
    return column.other ? column.count - 1 : 'outside';
}

/** How a column index reads in a message: `"BE"`, `any other value`, `below 50`, `50 up to 100`, `100 and above` */
export function describeIndex(column: TableColumn, index: number): string {
    if (column.breaks) {
        const breaks = column.breaks;
        if (breaks.length === 0) return 'any value';
        if (index === 0) return `below ${breaks[0] as number}`;
        if (index === breaks.length) return `${breaks[index - 1] as number} and above`;
        return `${breaks[index - 1] as number} up to ${breaks[index] as number}`;
    }
    if (column.other && index === column.count - 1) return 'any other value';
    return key(column.values?.[index] as JsonValue);
}

/**
 * Which indexes of a column a row's condition matches, or a reason it cannot be read. A list column takes one of its
 * values, a list of them (any of) or `*`; a breaks column takes `*` or comparisons with its breaks, `>=50`, `<100`
 * or both (`>=50 <100`), since a bucket lies wholly on one side of each break
 */
function conditionIndexes(column: TableColumn, condition: JsonValue): boolean[] | string {
    const all = (): boolean[] => new Array<boolean>(column.count).fill(true);
    if (condition === OTHER_VALUE) return all();
    if (column.breaks) {
        if (typeof condition !== 'string') return `"${column.name}" takes "*" or comparisons with its breaks, such as ">=50" or ">=50 <100"`;
        const matches = all();
        for (const part of condition.trim().split(/\s+/)) {
            const comparison = COMPARISON.exec(part);
            const at = comparison ? column.breaks.indexOf(Number(comparison[2])) : -1;
            if (!comparison || at < 0) return `"${part}" is not a comparison with a break of "${column.name}" (${column.breaks.join(', ')}); use ">=" or "<" with one of them`;
            // bucket i covers [breaks[i-1], breaks[i]): ">= breaks[at]" is buckets above `at`, "< breaks[at]" is buckets up to `at`
            for (let index = 0; index < column.count; index += 1) {
                if (comparison[1] === '>=' ? index <= at : index > at) matches[index] = false;
            }
        }
        return matches;
    }
    const wanted = Array.isArray(condition) ? condition : [condition];
    if (wanted.length === 0) return `"${column.name}" needs at least one value`;
    const matches = new Array<boolean>(column.count).fill(false);
    for (const value of wanted) {
        const found = (column.values ?? []).findIndex((item) => key(item) === key(value));
        if (found < 0) return `${key(value)} is not one of the values of "${column.name}"`;
        matches[found] = true;
    }
    return matches;
}

/** The cell number of one index per column */
function cellOf(columns: readonly TableColumn[], indexes: readonly number[]): number {
    let cell = 0;
    columns.forEach((column, at) => {
        cell = cell * column.count + (indexes[at] as number);
    });
    return cell;
}

function indexesOf(columns: readonly TableColumn[], cell: number): number[] {
    const indexes = new Array<number>(columns.length);
    for (let at = columns.length - 1; at >= 0; at -= 1) {
        const count = (columns[at] as TableColumn).count;
        indexes[at] = cell % count;
        cell = Math.floor(cell / count);
    }
    return indexes;
}

/** The most gaps a problem names */
const MAX_GAPS_NAMED = 3;

/**
 * Compiles a table's rows over its columns. A row's keys are key input names (conditions; a key input it leaves out
 * matches any value) and output names (values); a plain input cannot be a condition. Up to `MAX_TABLE_CELLS` cells the
 * winning row of every cell is computed, which finds gaps (a combination no row covers) and rows that win no cell;
 * above it the table is matched row by row and neither is checked. Returns the compiled table only when the rows have
 * no `shape` problem
 */
export function compileTable(
    table: Pick<LogicTable, 'inputs' | 'outputs'>,
    rows: readonly LogicTableRow[],
    columns: readonly TableColumn[] = tableColumns(table.inputs)
): { compiled?: CompiledTable; problems: TableProblem[] } {
    const problems: TableProblem[] = [];
    const byName = new Map(columns.map((column) => [column.name, column]));
    const outputs = Object.keys(table.outputs);
    const compiledRows: CompiledRow[] = [];
    rows.forEach((row, index) => {
        if (!isObject(row as JsonValue)) {
            problems.push({ at: `rows.${index}`, code: 'shape', message: 'a row must be an object of input conditions and output values' });
            return;
        }
        const matches = columns.map((column) => new Array<boolean>(column.count).fill(true));
        const values: JsonObject = {};
        for (const [name, value] of Object.entries(row)) {
            const column = byName.get(name);
            if (column) {
                const read = conditionIndexes(column, value);
                if (typeof read === 'string') problems.push({ at: `rows.${index}.${name}`, code: 'shape', message: read });
                else matches[columns.indexOf(column)] = read;
            } else if (outputs.includes(name)) {
                values[name] = value;
            } else if (Object.hasOwn(table.inputs, name)) {
                problems.push({ at: `rows.${index}.${name}`, code: 'shape', message: `"${name}" has no values or breaks, so a row cannot match on it; it can be read in the outputs as $${name}` });
            } else {
                problems.push({ at: `rows.${index}.${name}`, code: 'shape', message: `"${name}" is neither a key input nor an output of the table` });
            }
        }
        compiledRows.push({ matches, outputs: values });
    });
    if (problems.length > 0) return { problems };

    const size = columns.reduce((product, column) => product * column.count, 1);
    if (size > MAX_TABLE_CELLS) {
        problems.push({ at: 'inputs', code: 'size', message: String(size) });
        return { compiled: { columns, rows: compiledRows, size }, problems };
    }
    const cells = new Int32Array(size).fill(-1);
    const wins = new Array<boolean>(compiledRows.length).fill(false);
    for (let cell = 0; cell < size; cell += 1) {
        const indexes = indexesOf(columns, cell);
        const winner = compiledRows.findIndex((row) => row.matches.every((matched, at) => matched[indexes[at] as number]));
        cells[cell] = winner;
        if (winner >= 0) wins[winner] = true;
    }
    const gaps: string[] = [];
    let gapCount = 0;
    for (let cell = 0; cell < size; cell += 1) {
        if (cells[cell] !== -1) continue;
        gapCount += 1;
        if (gaps.length < MAX_GAPS_NAMED) {
            const indexes = indexesOf(columns, cell);
            gaps.push(columns.map((column, at) => `${column.name} ${describeIndex(column, indexes[at] as number)}`).join(', '));
        }
    }
    if (gapCount > 0) {
        const more = gapCount > gaps.length ? ` (and ${gapCount - gaps.length} more)` : '';
        problems.push({ at: 'rows', code: 'gap', message: `${gaps.join('; ')}${more}` });
    }
    wins.forEach((won, index) => {
        if (!won) problems.push({ at: `rows.${index}`, code: 'unreachable', message: '' });
    });
    return { compiled: { columns, rows: compiledRows, size, cells }, problems };
}

/** The winning row of the column indexes, or -1 when no row covers them */
export function lookupRow(table: CompiledTable, indexes: readonly number[]): number {
    if (table.cells) return table.cells[cellOf(table.columns, indexes)] as number;
    return table.rows.findIndex((row) => row.matches.every((matched, at) => matched[indexes[at] as number]));
}
