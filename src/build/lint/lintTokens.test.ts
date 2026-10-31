import { describe, expect, it } from 'vitest';
import type { ComponentToken } from '../../core/theme/index.js';
import { generateSharedSheet } from '../../dom/articulation/index.js';
import { applyTokenFallbacks } from '../tokenFallbacks.js';
import { checkTokens, lintCss } from './index.js';

const BUTTON: readonly ComponentToken[] = [
    { path: 'button.radius', group: 'button', type: 'dimension', default: '{radius.md}' },
    { path: 'button.padding.inline', group: 'button', type: 'dimension', default: 'calc({space.inset.md} * 2)' }
];
const context = { component: 'x', file: 'atoms/x/x.view.css', tokens: BUTTON };

function locations(css: string): [string, number | undefined, number | undefined][] {
    return lintCss(css, context).map((error) => [error.code, error.line, error.column]);
}

describe('lintCss', () => {
    it('should report a primitive palette token with its line and column', () => {
        // Arrange
        const css = 'p {\n    color: var(--ui-palette-blue-600);\n}';

        // Act
        const errors = lintCss(css, context);

        // Assert
        expect(errors).toEqual([
            expect.objectContaining({ code: 'SUI-BUILD-TOKEN', file: 'atoms/x/x.view.css', line: 2, column: 16 })
        ]);
        expect(errors[0]?.message).toContain('--ui-palette-blue-600');
    });

    it('should report a scale token and any font token', () => {
        expect(locations('a { gap: var(--ui-scale-space-3); }')).toEqual([['SUI-BUILD-TOKEN', 1, 14]]);
        expect(locations('a { font-family: var(--ui-font-family-sans); }')).toEqual([['SUI-BUILD-TOKEN', 1, 22]]);
        expect(locations('a { font-size: var(--ui-font-size-3); }')).toEqual([['SUI-BUILD-TOKEN', 1, 20]]);
    });

    it('should report a var name that is neither a default token nor a declared component token', () => {
        expect(locations('a { gap: var(--ui-nope-x); }')).toEqual([['SUI-BUILD-TOKEN', 1, 14]]);
        expect(locations('a { gap: var(--ui-button-nope); }')).toEqual([['SUI-BUILD-TOKEN', 1, 14]]);
    });

    it('should report each literal colour form at its position', () => {
        const css = ['a {', '    color: #fff;', '    background: rgb(0 0 0);', '    border-color: rgba(0, 0, 0, 0.5);', '    fill: hsl(10 20% 30%);', '    stroke: hsla(10, 20%, 30%, 1);', '    outline-color: #12345678;', '}'].join('\n');

        expect(locations(css)).toEqual([
            ['SUI-BUILD-TOKEN', 2, 12],
            ['SUI-BUILD-TOKEN', 3, 17],
            ['SUI-BUILD-TOKEN', 4, 19],
            ['SUI-BUILD-TOKEN', 5, 11],
            ['SUI-BUILD-TOKEN', 6, 13],
            ['SUI-BUILD-TOKEN', 7, 20]
        ]);
    });

    it('should accept a semantic token and a component token of another group', () => {
        const css = 'a { color: var(--ui-color-text-muted); border-radius: var(--ui-button-radius); gap: var(--ui-density-factor); }';

        expect(lintCss(css, { ...context, component: 'card' })).toEqual([]);
    });

    it('should find a primitive inside a calc()', () => {
        expect(locations('a { gap: calc(var(--ui-scale-space-2) * 2); }')).toEqual([['SUI-BUILD-TOKEN', 1, 19]]);
    });

    it('should find a primitive used as the fallback of a semantic token', () => {
        expect(locations('a { gap: var(--ui-space-gap-md, var(--ui-scale-space-3)); }')).toEqual([['SUI-BUILD-TOKEN', 1, 37]]);
    });

    it('should ignore a colour or a primitive inside a comment, a string or url()', () => {
        const css = '/* #fff var(--ui-palette-red)\n rgb(0 0 0) */\na { color: red; content: "#fff var(--ui-scale-x)"; background: url(#abc); }';

        expect(lintCss(css, context)).toEqual([]);
    });

    it('should not take an id selector for a colour', () => {
        expect(lintCss('#add { margin: 0; }\n#fade .x { margin: 0; }', context)).toEqual([]);
    });

    it('should report a hand-written fallback that differs from the shape default', () => {
        const css = 'a { border-radius: var(--ui-button-radius, 0); }';

        const errors = lintCss(css, context);

        expect(errors.map((error) => [error.code, error.line, error.column])).toEqual([['SUI-BUILD-TOKEN', 1, 24]]);
        expect(errors[0]?.message).toContain('fallback');
    });

    it('should accept a hand-written fallback equal to the default, however it is spaced', () => {
        const css = 'a { border-radius: var(--ui-button-radius,var( --ui-radius-md )); padding: var(--ui-button-padding-inline, calc(var(--ui-space-inset-md)*2)); }';

        expect(lintCss(css, context)).toEqual([]);
    });

    it('should report a re-declared semantic token that is not its own default expression', () => {
        expect(locations(':host { --ui-space-inset-md: var(--ui-scale-space-9); }')).toEqual([['SUI-BUILD-TOKEN', 1, 34]]);
    });

    it('should pass the generated shared sheet', () => {
        // Arrange / Act
        const errors = lintCss(generateSharedSheet(), { file: 'shared', tokens: [] });

        // Assert
        expect(errors).toEqual([]);
        expect(generateSharedSheet()).toContain('var(--ui-scale-space-');
    });

    it('should run as a cssCheck on a clean sheet without errors', () => {
        expect(checkTokens(':host { display: block; color: var(--ui-color-text-base); }', context)).toEqual([]);
    });
});

describe('applyTokenFallbacks', () => {
    it('should add the default as a live fallback to a bare component token', () => {
        // Arrange
        const css = 'a { border-radius: var(--ui-button-radius); padding: var(--ui-button-padding-inline); }';

        // Act
        const result = applyTokenFallbacks(css, context);

        // Assert
        expect(result).toBe(
            'a { border-radius: var(--ui-button-radius, var(--ui-radius-md)); padding: var(--ui-button-padding-inline, calc(var(--ui-space-inset-md) * 2)); }'
        );
    });

    it('should leave a var that has a fallback, other names, comments and strings alone', () => {
        // Arrange
        const css = '/* var(--ui-button-radius) */ a { x: var(--ui-button-radius, 1px); y: var(--ui-radius-md); content: "var(--ui-button-radius)"; }';

        // Act / Assert
        expect(applyTokenFallbacks(css, context)).toBe(css);
    });

    it('should return the css unchanged when the library declares no tokens', () => {
        expect(applyTokenFallbacks('a { b: var(--ui-button-radius); }', { ...context, tokens: [] })).toBe('a { b: var(--ui-button-radius); }');
    });

    it('should rewrite a bare token nested in the fallback of another var', () => {
        const css = 'a { x: var(--ui-radius-md, var(--ui-button-radius)); }';

        expect(applyTokenFallbacks(css, context)).toBe('a { x: var(--ui-radius-md, var(--ui-button-radius, var(--ui-radius-md))); }');
    });
});

describe('generated sheets', () => {
    it('should pass the generated layout sheets', async () => {
        // Arrange
        const { generateLayoutSheets } = await import('../../dom/layout/index.js');

        // Act
        const errors = lintCss(generateLayoutSheets(), { file: 'layout', tokens: [] });

        // Assert
        expect(errors).toEqual([]);
    });
});

describe('focus and motion rules', () => {
    it.each([
        ['outline: none', 'a:focus { outline: none; }', 1, 11],
        ['outline: 0', 'a:focus { outline: 0; }', 1, 11],
        ['outline: 0px', 'a:focus { outline: 0px; }', 1, 11],
        ['outline-width: 0', 'a:focus {\n    outline-width: 0;\n}', 2, 5],
        ['outline: none !important', 'a { outline: none !important; }', 1, 5],
        ['outline: 0 solid', 'a { outline: 0 solid; }', 1, 5]
    ])('should reject %s with SUI-BUILD-TOKEN at its position', (_name, css, line, column) => {
        // Act
        const errors = lintCss(css, context);

        // Assert
        expect(errors).toEqual([expect.objectContaining({ code: 'SUI-BUILD-TOKEN', file: 'atoms/x/x.view.css', line, column })]);
        expect(errors[0]?.message).toContain('outline');
    });

    it('should accept an outline drawn from tokens and a non-zero outline width', () => {
        expect(lintCss('a { outline: var(--ui-focus-width) solid var(--ui-color-focus); outline-width: 2px; outline-offset: 0; }', context)).toEqual([]);
        expect(lintCss('a { outline: 1px solid var(--ui-color-focus, 0); }', context)).toEqual([]);
    });

    it.each([
        ['transition: opacity 200ms ease', 'a { transition: opacity 200ms ease; }', 1, 25],
        ['transition-duration: 0.2s', 'a { transition-duration: 0.2s; }', 1, 26],
        ['transition-delay: 50ms', 'a { transition-delay: 50ms; }', 1, 23],
        ['animation: spin 1s linear', 'a { animation: spin 1s linear; }', 1, 21],
        ['animation-duration: .5s', 'a { animation-duration: .5s; }', 1, 25],
        ['animation-delay: 0s', 'a { animation-delay: 0s; }', 1, 22]
    ])('should reject a literal duration in %s', (_name, css, line, column) => {
        // Act
        const errors = lintCss(css, context);

        // Assert
        expect(errors).toEqual([expect.objectContaining({ code: 'SUI-BUILD-TOKEN', line, column })]);
        expect(errors[0]?.message).toContain('motion token');
    });

    it('should accept durations from motion tokens and literals outside transition and animation', () => {
        const css = [
            'a { transition: opacity var(--ui-motion-duration-base) ease; }',
            'b { animation: spin calc(var(--ui-motion-duration-slow) * 2) linear; }',
            'c { transition: none; animation-name: fade-2s; }',
            'd { width: 10s; /* transition: 1s */ }'
        ].join('\n');

        expect(lintCss(css, context)).toEqual([]);
    });

    it('should report both offences of one rule in source order', () => {
        // Act
        const errors = lintCss('a { transition: all 1s; outline: none; }', context);

        // Assert
        expect(errors.map((error) => error.column)).toEqual([21, 25]);
    });
});

describe('the shared sheet', () => {
    it('should pass the lint with its focus and forced-colors rules', () => {
        // Act
        const errors = lintCss(generateSharedSheet(), { file: 'shared', tokens: [] });

        // Assert
        expect(errors).toEqual([]);
    });
});
