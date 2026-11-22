import { exportColumnsOf, exportRecords, MAX_EXPORT_ROWS, readExportRequest, toCsv } from './recordExport.js';
import type { RecordExportRequest } from './recordExport.js';
import { foldText, passesFilters } from './recordView.js';

const columns = exportColumnsOf({
    name: { _title: 'Name', field: 'name', filter: 'text' },
    state: { _title: 'State', field: 'state', filter: 'select', options: { open: { _label: 'Open' }, done: { _label: 'Done' } } },
    units: { _title: 'Units', field: 'units' },
    actions: { _title: 'Actions' }
});
const records = {
    a: { name: 'Café Ada', state: 'open', units: 4 },
    b: { name: 'Grace', state: 'done', units: 6 },
    c: { name: '=HYPERLINK("x")', state: 'open', units: 10 },
    d: { name: 'Lovelace, "Ada"', units: -1 }
};
const request = (overrides: Partial<RecordExportRequest> = {}): RecordExportRequest => ({ columns, filter: '', filters: {}, sortBy: '', sortDir: 'asc', ...overrides });

describe('exportColumnsOf', () => {
    it('should read the columns with a field, with their title, filter and option labels', () => {
        // Assert
        expect(columns.map((column) => column.key)).toEqual(['name', 'state', 'units']);
        expect(columns[1]).toEqual({ key: 'state', field: 'state', title: 'State', filter: 'select', options: { open: 'Open', done: 'Done' } });
    });
});

describe('passesFilters', () => {
    it('should match the quick filter ignoring case and accents, and a select option by its label', () => {
        // Assert
        expect(passesFilters(records.a, columns, foldText('cafe'), {})).toBe(true);
        expect(passesFilters(records.b, columns, foldText('DONE'), {})).toBe(true);
        expect(passesFilters(records.b, columns, '', { state: 'open' })).toBe(false);
    });
});

describe('exportRecords', () => {
    it('should write the header and the cells of every record, select labels, guarded formulas and numbers as text', () => {
        // Act
        const result = exportRecords(records, request());

        // Assert
        expect(result).toEqual({
            kind: 'rows',
            count: 4,
            rows: [
                ['Name', 'State', 'Units'],
                ['Café Ada', 'Open', '4'],
                ['Grace', 'Done', '6'],
                ['\'=HYPERLINK("x")', 'Open', '10'],
                ['Lovelace, "Ada"', '', '-1']
            ]
        });
    });

    it('should keep only the records that pass the filters, sorted with values that are nothing last', () => {
        // Act
        const result = exportRecords(Object.values(records), request({ filter: 'a', sortBy: 'state', sortDir: 'desc' }));

        // Assert
        expect(result.kind === 'rows' && result.rows.map((row) => row[0])).toEqual(['Name', 'Café Ada', 'Grace', 'Lovelace, "Ada"']);
    });

    it('should refuse a source that is not records and one with more rows than the cap', () => {
        // Arrange
        const many = Array.from({ length: MAX_EXPORT_ROWS + 1 }, () => ({ name: 'x' }));

        // Act and Assert
        expect(exportRecords('text', request())).toEqual({ kind: 'not-records' });
        expect(exportRecords(many, request())).toEqual({ kind: 'too-large' });
    });
});

describe('readExportRequest', () => {
    it('should read a request a grid sends and fill what it leaves out', () => {
        // Act
        const read = readExportRequest({ columns: [{ key: 'name', field: 'name', title: 'Name' }], filters: { name: 'a', state: ' ' } });

        // Assert
        expect(read).toEqual({ columns: [{ key: 'name', field: 'name', title: 'Name', filter: 'none', options: {} }], filter: '', filters: { name: 'a' }, sortBy: '', sortDir: 'asc' });
    });

    it('should refuse unknown keys, a field that is not a dotted name, no columns and long text', () => {
        // Assert
        expect(readExportRequest({ columns: [{ key: 'n', field: 'n', title: 'N' }], rows: [] })).toBeUndefined();
        expect(readExportRequest({ columns: [{ key: 'n', field: 'a[0]', title: 'N' }] })).toBeUndefined();
        expect(readExportRequest({ columns: [] })).toBeUndefined();
        expect(readExportRequest({ columns: [{ key: 'n', field: 'n', title: 'x'.repeat(501) }] })).toBeUndefined();
        expect(readExportRequest({ columns: [{ key: 'n', field: 'n', title: 'N' }], sortDir: 'up' })).toBeUndefined();
    });
});

describe('toCsv', () => {
    it('should quote fields with commas, quotes or line breaks and end each line in CRLF', () => {
        // Assert
        expect(toCsv([['a', 'b,c'], ['say "hi"', 'x\ny']])).toBe('a,"b,c"\r\n"say ""hi""","x\ny"\r\n');
    });
});
