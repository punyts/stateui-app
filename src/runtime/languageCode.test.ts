import { describe, expect, it } from 'vitest';
import { readBlueprint } from '../core/blueprint/index.js';
import { scanLibrary } from '../core/convention/index.js';
import { LANGUAGE_CODE } from '../core/locale/index.js';
import { checkRoot } from '../core/validate/document.js';
import type { JsonValue } from '../core/types.js';
import { PROTOCOL_VERSION } from './protocol.js';
import { validateMessage } from './validate.js';

const CODES = [
    'en', 'de', 'pt-BR', 'zh-Hant-TW', 'gsw', 'es-419', 'sl-Latn-IT-rozaj-biske',
    'DE', 'e', 'engl', 'pt_BR', 'pt-B', 'de-', 'pt-abcdefghi', '-de', 'en-aa-bb-cc-dd-ee', `de-${'aa-'.repeat(40)}aa`
];

const FOLDER = ['form/note/note.view.html', 'form/note/note.view.css', 'form/note/note.controller.ts', 'form/note/note.state.json'];

/** Whether each judge of a language code takes `code` */
function judged(code: string): Record<string, boolean> {
    const blueprint = { locale: code, start: 'home', app: { component: 'app' }, screens: { home: { root: { component: 'panel' } } } };
    const overlays = { locale: 'en', locales: { [code]: {} }, start: 'home', app: { component: 'app' }, screens: { home: { root: { component: 'panel' }, locales: { [code]: {} } } } };
    const screens = { home: { root: { component: 'panel' }, locales: { [code]: {} } } };
    const files = Object.fromEntries([...FOLDER, `form/note/note.locale.${code}.json`].map((path) => [path, '']));
    return {
        blueprint: readBlueprint(blueprint as unknown as JsonValue).errors.length === 0,
        document: checkRoot({ locale: code, app: { component: 'panel' } }).length === 0,
        blueprintLocales: readBlueprint(overlays as unknown as JsonValue).errors.length === 0,
        documentLocales: checkRoot({ locales: { [code]: {} }, app: { component: 'panel' } }).length === 0,
        screenLocales: checkRoot({ app: { component: 'panel' }, start: 'home', screens } as unknown as Record<string, JsonValue>).length === 0,
        runtime: validateMessage({ v: PROTOCOL_VERSION, nonce: 'n', type: 'locale', locale: code }).ok,
        library: scanLibrary(files).errors.length === 0
    };
}

describe('LANGUAGE_CODE', () => {
    it('should be the one pattern the blueprint reader, the document check, the runtime and scanLibrary judge a code and an overlay key by', () => {
        // Arrange
        const expected = CODES.map((code) => LANGUAGE_CODE.test(code));

        // Act
        const verdicts = CODES.map((code) => judged(code));

        // Assert
        expect(expected).toEqual([true, true, true, true, true, true, true, false, false, false, false, false, false, false, false, false, false]);
        verdicts.forEach((verdict, index) => {
            const accepted = expected[index];
            expect(verdict, CODES[index]).toEqual({
                blueprint: accepted,
                document: accepted,
                blueprintLocales: accepted,
                documentLocales: accepted,
                screenLocales: accepted,
                runtime: accepted,
                library: accepted
            });
        });
    });
});
