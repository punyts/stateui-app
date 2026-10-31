import { describe, expect, it } from 'vitest';
import { ERROR_CATALOG, ERROR_PREFIXES, TEMPLATE_PLACEHOLDERS, buildError, isValid } from './index.js';
import type { ErrorCode } from './index.js';

const CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];

function detailsFor(code: ErrorCode): Record<string, string> {
    const details: Record<string, string> = {};
    for (const match of ERROR_CATALOG[code].template.matchAll(/\{([a-zA-Z]+)\}/g)) {
        details[match[1] as string] = `<${match[1]}>`;
    }
    return details;
}

describe('error catalog', () => {
    it.each(CODES)('builds %s from its template', (code) => {
        const error = buildError(code, detailsFor(code));

        expect(error.code).toBe(code);
        expect(error.message).not.toMatch(/[{}]/);
        expect(error.message.length).toBeGreaterThan(0);
    });

    it('has every prefix and only known prefixes', () => {
        const used = new Set(CODES.map((code) => code.split('-').slice(0, 2).join('-')));

        for (const prefix of ERROR_PREFIXES) {
            expect(used.has(prefix)).toBe(true);
        }
        for (const prefix of used) expect(ERROR_PREFIXES).toContain(prefix);
    });

    it('includes the sub-codes the specs name', () => {
        for (const code of ['SUI-THEME-NAME', 'SUI-THEME-OVERLAY', 'SUI-THEME-CONTRAST', 'SUI-THEME-REF', 'SUI-THEME-VALUE', 'SUI-THEME-TOKEN',
            'SUI-BUILD-TOKEN',
            'SUI-LOCALE-UNKNOWN',
            'SUI-LOCALE-MORE',
            'SUI-LOCALE-LINKED',
            'SUI-STATE-SHARED',
            'SUI-BUILD-KEY',
            'SUI-BUILD-VALIDATOR',
            'SUI-BUILD-KIND',
            'SUI-BUILD-DEFAULT',
            'SUI-BUILD-PATTERN',
            'SUI-BUILD-SUMMARY',
            'SUI-STATE-CONDITION',
            'SUI-STATE-RUNTIME',
            'SUI-LINK-ROW',
            'SUI-LINK-TARGET'
        ]) {
            expect(CODES).toContain(code);
        }
    });

    it('defaults severity to absent and marks contrast and missing translations as warnings', () => {
        expect(buildError('SUI-NODE-MISSING', { path: '$.app.a' }).severity).toBeUndefined();
        expect(buildError('SUI-THEME-CONTRAST', { token: 'a', other: 'b', actual: 3, limit: 4.5 }).severity).toBe('warning');
        expect(buildError('SUI-LOCALE-MISSING', { locale: 'de', path: '$.app.a._title' }).severity).toBe('warning');
    });

    it('words SUI-THEME-OVERLAY from the name, kind, path and a fixed reason', () => {
        const error = buildError('SUI-THEME-OVERLAY', { name: 'acme', other: 'brand', path: 'color.accent.base', key: 'token group outside the kind' });

        expect(error.message).toBe('Theme overlay "acme" of kind "brand" at color.accent.base is not allowed: token group outside the kind');
    });

    it('copies location fields onto the error and nothing else', () => {
        const error = buildError('SUI-BUILD-TOKEN', { file: 'a/a.view.css', token: '--x', line: 3, column: 7 });

        expect(error).toEqual({
            code: 'SUI-BUILD-TOKEN',
            message: expect.stringContaining('a/a.view.css'),
            file: 'a/a.view.css',
            line: 3,
            column: 7
        });
        expect(buildError('SUI-NODE-UNKNOWN', { component: 'x', path: '$.app', statePath: '$.app' })).toMatchObject({
            component: 'x',
            statePath: '$.app'
        });
    });

    it('survives a JSON round trip', () => {
        const error = buildError('SUI-DOC-LIMIT-NODES', { actual: 5, limit: 4 });

        expect(JSON.parse(JSON.stringify(error))).toEqual(error);
    });

    it('throws when a placeholder has no detail', () => {
        expect(() => buildError('SUI-NODE-MISSING')).toThrow('SUI-NODE-MISSING');
    });

    it('uses only whitelisted placeholders', () => {
        for (const code of CODES) {
            for (const name of Object.keys(detailsFor(code))) expect(TEMPLATE_PLACEHOLDERS).toContain(name);
        }
    });

    it('never puts content or data values in a message', () => {
        const secret = 'Hunter2 secret value';
        const error = buildError('SUI-STATE-INVALID', {
            name: 'title',
            path: '$.app.a',
            component: 'text',
            ...({ value: secret, content: secret } as object)
        });

        expect(error.message).not.toContain(secret);
        expect(JSON.stringify(error)).not.toContain(secret);
    });

    it('treats a warning-only list as valid', () => {
        const warning = buildError('SUI-LOCALE-MISSING', { locale: 'de', path: '$.app.a' });
        const failure = buildError('SUI-NODE-MISSING', { path: '$.app.b' });

        expect(isValid([])).toBe(true);
        expect(isValid([warning])).toBe(true);
        expect(isValid([warning, failure])).toBe(false);
    });
});
