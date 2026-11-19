import { report } from '@punyts/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FunctionTable, catalogOf, functionPaths, hostCatalog, isFunctionPath } from './table.js';
import type { LoadedFunction } from './table.js';
import type { FunctionCatalog, FunctionCode, FunctionKind } from './types.js';

function loaded(path: string, kind: FunctionKind = 'expression', code: FunctionCode = (() => 1) as FunctionCode): LoadedFunction {
    return { id: crypto.randomUUID(), path, kind, runs: ['server', 'browser'], summary: path, inputs: {}, outputs: {}, code };
}

/** A catalog whose loader answers with a promise the test settles */
function lazyCatalog(name: string, functions: LoadedFunction[]) {
    const asked: string[] = [];
    const pending: { id: string; resolve(code: FunctionCode): void; reject(error: Error): void }[] = [];
    const catalog: FunctionCatalog = {
        name,
        entries: functions.map(({ code: _code, ...entry }) => entry),
        load: (id) => {
            asked.push(id);
            return new Promise((resolve, reject) => pending.push({ id, resolve, reject }));
        }
    };
    return { catalog, asked, pending };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('function paths', () => {
    it('should accept a group function and a component function, and nothing else', () => {
        expect(isFunctionPath('$.functions.host.http')).toBe(true);
        expect(isFunctionPath('$.components.treeDiagram.functions.layoutTree')).toBe(true);
        expect(isFunctionPath('$.functions.http')).toBe(false);
        expect(isFunctionPath('$.functions.host.http.extra')).toBe(false);
        expect(isFunctionPath('$.data.functions.host.http')).toBe(false);
        expect(isFunctionPath('http')).toBe(false);
    });

    it('should find each function path named in a document once, inside expressions too', () => {
        // Arrange
        const document = {
            logic: { computes: { tax: { run: '$.functions.host.tax' } } },
            screens: { main: { text: '{{ $.functions.text.upper($.data.name) }} and {{ $.functions.host.tax }}' } },
            other: ['$.components.treeDiagram.functions.layoutTree', '$.functions.host.tax.not']
        };

        // Act
        const paths = functionPaths(document);

        // Assert
        expect(paths).toEqual(['$.functions.host.tax', '$.functions.text.upper', '$.components.treeDiagram.functions.layoutTree']);
    });
});

describe('FunctionTable', () => {
    it('should give the pointer at a path and the entries of the side it runs on', () => {
        // Arrange
        const http = loaded('$.functions.host.http', 'effect');
        const shout = { ...loaded('$.functions.text.shout'), runs: ['browser'] as const };

        // Act
        const server = new FunctionTable([catalogOf('host', [http]), catalogOf('text', [shout])], 'server');
        const browser = new FunctionTable([catalogOf('host', [http]), catalogOf('text', [shout])], 'browser');

        // Assert
        expect(server.pointer('$.functions.host.http')).toEqual({ fn: http.id });
        expect(server.entries().map((entry) => entry.path)).toEqual(['$.functions.host.http']);
        expect(browser.entries().map((entry) => entry.path)).toEqual(['$.functions.host.http', '$.functions.text.shout']);
        expect(server.has('$.functions.host.http', 'effect')).toBe(true);
        expect(server.has('$.functions.host.http', 'compute')).toBe(false);
    });

    it('should refuse catalogs that clash or entries that are malformed', () => {
        // Arrange
        const tax = loaded('$.functions.host.tax');
        const cases: [FunctionCatalog[], string][] = [
            [[catalogOf('host', [tax]), catalogOf('host', [{ ...tax, id: crypto.randomUUID() }])], 'host and host both have a function at $.functions.host.tax'],
            [[catalogOf('host', [tax]), catalogOf('money', [{ ...tax, path: '$.functions.money.tax' }])], `has the GUID of $.functions.host.tax`],
            [[catalogOf('money', [loaded('$.functions.host.tax')])], 'which is the host\'s group'],
            [[catalogOf('host', [loaded('$.functions.money.tax')])], 'is not under $.functions.host'],
            [[catalogOf('host', [{ ...tax, id: 'tax' }])], 'has no GUID for its id'],
            [[catalogOf('host', [{ ...tax, path: 'tax' }])], 'which is not a function path'],
            [[catalogOf('host', [{ ...tax, runs: [] }])], 'runs nowhere']
        ];

        // Act
        const thrown = cases.map(([catalogs]) => {
            try {
                new FunctionTable(catalogs, 'server');
                return '';
            } catch (error) {
                return (error as Error).message;
            }
        });

        // Assert
        thrown.forEach((message, index) => expect(message).toContain(cases[index]![1]));
    });

    it('should load at once from a catalog whose loader answers at once', () => {
        // Arrange
        const shout = loaded('$.functions.host.shout', 'expression', ((text: unknown) => `${String(text)}!`) as FunctionCode);
        const table = new FunctionTable([catalogOf('host', [shout])], 'server');

        // Act
        const before = table.expression('$.functions.host.shout');
        const loading = table.prepare(['$.functions.host.shout', '$.functions.host.missing']);

        // Assert
        expect(before).toBeUndefined();
        expect(loading).toBeUndefined();
        expect(table.expression('$.functions.host.shout')?.('a')).toBe('a!');
        expect(table.compute('$.functions.host.shout')).toBeUndefined();
    });

    it('should load a lazy catalog only for the paths asked for, once each', async () => {
        // Arrange
        const used = loaded('$.functions.lazy.used');
        const unused = loaded('$.functions.lazy.unused');
        const lazy = lazyCatalog('lazy', [used, unused]);
        const table = new FunctionTable([lazy.catalog], 'browser');

        // Act
        const first = table.prepare(['$.functions.lazy.used']);
        const second = table.prepare(['$.functions.lazy.used']);
        lazy.pending[0]!.resolve(used.code);
        await first;
        await second;
        const third = table.prepare(['$.functions.lazy.used']);

        // Assert
        expect(lazy.asked).toEqual([used.id]);
        expect(table.expression('$.functions.lazy.used')).toBe(used.code);
        expect(third).toBeUndefined();
    });

    it('should report a load that fails and leave that function unloaded', async () => {
        // Arrange
        const warning = vi.spyOn(report, 'warning').mockImplementation(() => undefined);
        const broken = loaded('$.functions.lazy.broken');
        const lazy = lazyCatalog('lazy', [broken]);
        const table = new FunctionTable([lazy.catalog], 'browser');

        // Act
        const loading = table.prepare(['$.functions.lazy.broken']);
        lazy.pending[0]!.reject(new Error('offline'));
        await loading;

        // Assert
        expect(table.expression('$.functions.lazy.broken')).toBeUndefined();
        expect(warning).toHaveBeenCalledWith('A function could not be loaded', { path: '$.functions.lazy.broken', catalog: 'lazy', reason: 'Error: offline' });
    });
});

describe('hostCatalog', () => {
    it('should put each host function under $.functions.host, on both sides unless it says otherwise', () => {
        // Arrange
        const id = crypto.randomUUID();
        const fetchId = crypto.randomUUID();

        // Act
        const catalog = hostCatalog({
            shout: { id, kind: 'expression', code: (() => 1) as FunctionCode, summary: 'Shouts' },
            fetch: { id: fetchId, kind: 'effect', code: (() => Promise.resolve({})) as FunctionCode, summary: 'Fetches', runs: ['server'] }
        });

        // Assert
        expect(catalog.name).toBe('host');
        expect(catalog.entries).toEqual([
            { id, path: '$.functions.host.shout', kind: 'expression', runs: ['server', 'browser'], summary: 'Shouts', inputs: {}, outputs: {} },
            { id: fetchId, path: '$.functions.host.fetch', kind: 'effect', runs: ['server'], summary: 'Fetches', inputs: {}, outputs: {} }
        ]);
        expect(new FunctionTable([catalog], 'browser').entries().map((entry) => entry.path)).toEqual(['$.functions.host.shout']);
    });
});

describe('FunctionTable without a side', () => {
    it('should hold the entries of both sides, as the validator sees them', () => {
        // Arrange
        const server = { ...loaded('$.functions.host.http', 'effect'), runs: ['server'] as const };
        const browser = { ...loaded('$.functions.host.shout'), runs: ['browser'] as const };

        // Act
        const table = new FunctionTable([catalogOf('host', [server, browser])]);

        // Assert
        expect(table.entries().map((entry) => entry.path)).toEqual(['$.functions.host.http', '$.functions.host.shout']);
        expect(table.has('$.functions.host.shout', 'expression')).toBe(true);
    });
});
