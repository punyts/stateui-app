import { describe, expect, it } from 'vitest';
import { scanLibrary } from './scanLibrary.js';
import type { FileMap } from './types.js';

function files(...paths: string[]): FileMap {
    return Object.fromEntries(paths.map((path) => [path, '']));
}

const TEXT_FIELD = [
    'form/text-field/text-field.view.html',
    'form/text-field/text-field.view.css',
    'form/text-field/text-field.controller.ts',
    'form/text-field/text-field.state.json',
    'form/text-field/text-field.locale.de.json',
    'form/text-field/text-field.locale.pt-BR.json'
];

describe('scanLibrary', () => {
    it('turns the form/text-field folder into one root component', () => {
        const result = scanLibrary(files(...TEXT_FIELD));

        expect(result.errors).toEqual([]);
        expect(result.components).toEqual([
            {
                name: 'textField',
                tier: 'root',
                tag: 'ui-text-field',
                group: 'form',
                files: {
                    view: 'form/text-field/text-field.view.html',
                    css: 'form/text-field/text-field.view.css',
                    controller: 'form/text-field/text-field.controller.ts',
                    state: 'form/text-field/text-field.state.json'
                },
                locales: {
                    de: 'form/text-field/text-field.locale.de.json',
                    'pt-BR': 'form/text-field/text-field.locale.pt-BR.json'
                }
            }
        ]);
    });

    it('reads a composed component and joins nested parent folders into the group', () => {
        const result = scanLibrary(files('a/b/login-form/login-form.composed.json', 'a/b/login-form/login-form.locale.de.json'));

        expect(result.errors).toEqual([]);
        expect(result.components).toEqual([
            {
                name: 'loginForm',
                tier: 'composed',
                tag: 'ui-login-form',
                group: 'a/b',
                files: { composed: 'a/b/login-form/login-form.composed.json' },
                locales: { de: 'a/b/login-form/login-form.locale.de.json' }
            }
        ]);
    });

    it('accepts a component folder at the top with an empty group', () => {
        const result = scanLibrary(files('text/text.view.html', 'text/text.state.json'));

        expect(result.components[0]?.group).toBe('');
    });

    it('sorts components by name whatever the input order', () => {
        const result = scanLibrary(files('x/zed/zed.view.html', 'x/zed/zed.state.json', 'x/alpha/alpha.view.html', 'x/alpha/alpha.state.json'));

        expect(result.components.map((component) => component.name)).toEqual(['alpha', 'zed']);
    });

    it('rejects an unknown role', () => {
        const result = scanLibrary(files(...TEXT_FIELD, 'form/text-field/text-field.notes.md'));

        expect(result.components).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-ROLE', file: 'form/text-field/text-field.notes.md' });
    });

    it('rejects a locale file with a malformed language code', () => {
        const result = scanLibrary(files(...TEXT_FIELD, 'form/text-field/text-field.locale.DE_x.json'));

        expect(result.errors.map((error) => error.file)).toEqual(['form/text-field/text-field.locale.DE_x.json']);
    });

    it('rejects a file name different from its folder name', () => {
        const result = scanLibrary(files('form/text-field/input.view.html', 'form/text-field/text-field.state.json'));

        expect(result.components).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-ROLE', file: 'form/text-field/input.view.html' });
    });

    it('rejects a file outside a component folder', () => {
        const result = scanLibrary(files('readme.view.html', ...TEXT_FIELD));

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-FILE', file: 'readme.view.html' });
        expect(result.components).toHaveLength(1);
    });

    it('rejects two components with the same name and names both files', () => {
        const result = scanLibrary(
            files('form/text-field/text-field.view.html', 'form/text-field/text-field.state.json', 'extra/text-field/text-field.view.html', 'extra/text-field/text-field.state.json')
        );

        expect(result.components).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ code: 'SUI-BUILD-DUPLICATE', file: 'extra/text-field/text-field.state.json' });
        expect(result.errors[0]?.message).toContain('extra/text-field/text-field.state.json and form/text-field/text-field.state.json');
    });

    it('rejects folders whose camel-cased names clash even when the tags differ', () => {
        const result = scanLibrary(files('g/a-1/a-1.composed.json', 'g/a1/a1.composed.json'));

        expect(result.components).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.message).toContain('g/a-1/a-1.composed.json and g/a1/a1.composed.json');
    });

    it('rejects a root and a composed component of the same name and names both files', () => {
        const result = scanLibrary(files('form/card/card.view.html', 'form/card/card.state.json', 'layout/card/card.composed.json'));

        expect(result.components).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.message).toContain('form/card/card.state.json and layout/card/card.composed.json');
    });

    it('rejects a folder with both root and composed files', () => {
        const result = scanLibrary(files('g/card/card.view.html', 'g/card/card.state.json', 'g/card/card.composed.json'));

        expect(result.components).toEqual([]);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.code).toBe('SUI-BUILD-TIER');
    });

    it('rejects a root component without state.json', () => {
        const result = scanLibrary(files('g/card/card.view.html', 'g/card/card.view.css'));

        expect(result.components).toEqual([]);
        expect(result.errors[0]?.code).toBe('SUI-BUILD-MISSING');
        expect(result.errors[0]?.message).toContain('state.json');
    });

    it('reads a folder with only a state file and locale overlays as a shape component without a tag', () => {
        const result = scanLibrary(files('charts/dot/dot.state.json', 'charts/dot/dot.locale.de.json'));

        expect(result.errors).toEqual([]);
        expect(result.components).toEqual([
            {
                name: 'dot',
                tier: 'shape',
                group: 'charts',
                files: { state: 'charts/dot/dot.state.json' },
                locales: { de: 'charts/dot/dot.locale.de.json' }
            }
        ]);
    });

    it('rejects a state file with a stylesheet or controller and no view as SUI-BUILD-TIER-SHAPE', () => {
        for (const extra of ['g/card/card.view.css', 'g/card/card.controller.ts']) {
            const result = scanLibrary(files('g/card/card.state.json', extra));

            expect(result.components).toEqual([]);
            expect(result.errors.map((error) => error.code)).toEqual(['SUI-BUILD-TIER-SHAPE']);
            expect(result.errors[0]?.message).toContain('Shape component "card"');
        }
    });

    it('rejects a composed component with a view file', () => {
        const result = scanLibrary(files('g/card/card.composed.json', 'g/card/card.view.css'));

        expect(result.components).toEqual([]);
        expect(result.errors).toHaveLength(1);
    });

    it('rejects a folder that holds only locale files', () => {
        const result = scanLibrary(files('g/card/card.locale.de.json'));

        expect(result.components).toEqual([]);
        expect(result.errors).toHaveLength(1);
    });

    describe('case sensitivity', () => {
        it('rejects a file name that differs from its folder only in case', () => {
            const result = scanLibrary(files('form/text-field/Text-Field.view.html', 'form/text-field/text-field.state.json'));

            expect(result.components).toEqual([]);
            expect(result.errors[0]).toMatchObject({ file: 'form/text-field/Text-Field.view.html' });
        });

        it('rejects an upper-case role or extension', () => {
            const result = scanLibrary(files('g/card/card.View.html', 'g/card/card.view.HTML', 'g/card/card.state.json'));

            expect(result.errors.map((error) => error.file)).toEqual(['g/card/card.View.html', 'g/card/card.view.HTML']);
        });

        it('rejects a folder name that is not lower-case kebab', () => {
            const result = scanLibrary(files('form/TextField/TextField.view.html', 'form/TextField/TextField.state.json'));

            expect(result.components).toEqual([]);
            expect(result.errors).toHaveLength(2);
        });

        it('keeps text-field and rejects Text-Field as a separate, invalid folder', () => {
            const result = scanLibrary(files('a/text-field/text-field.composed.json', 'b/Text-Field/Text-Field.composed.json'));

            expect(result.components.map((component) => component.name)).toEqual(['textField']);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]?.file).toBe('b/Text-Field/Text-Field.composed.json');
        });
    });

    it('keeps good components when another folder fails', () => {
        const result = scanLibrary(files(...TEXT_FIELD, 'g/bad/bad.view.html'));

        expect(result.components.map((component) => component.name)).toEqual(['textField']);
        expect(result.errors).toHaveLength(1);
    });

    it('is deterministic for a reordered input', () => {
        const forward = scanLibrary(files(...TEXT_FIELD, 'g/card/card.composed.json'));
        const backward = scanLibrary(files('g/card/card.composed.json', ...[...TEXT_FIELD].reverse()));

        expect(backward).toEqual(forward);
    });
});
