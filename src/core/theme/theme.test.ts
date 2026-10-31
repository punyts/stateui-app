import { describe, expect, it } from 'vitest';
import tokensJson from './tokens.default.json' with { type: 'json' };
import {
    DEFAULT_LEAVES,
    DEFAULT_TOKENS,
    TokenNameError,
    checkContrast,
    contrastRatio,
    cssName,
    flattenTokens,
    mergeOverDefaults,
    parseValue,
    toCssValue,
    validateReferences,
    validateTokenNames,
    validateTokenValue,
    validateTokens
} from './index.js';
import type { ComponentToken, TokenLeaf, TokenTree, TokenType } from './index.js';

function leaf(path: string, value: string, layer: TokenLeaf['layer']): TokenLeaf {
    return { path, cssName: cssName(path), layer, value };
}

function tree(value: TokenTree): TokenTree {
    return value;
}

describe('default token tree', () => {
    it('should give every leaf a layer and a type', () => {
        // Arrange / Act
        const leaves = flattenTokens(DEFAULT_TOKENS);

        // Assert
        expect(leaves.length).toBeGreaterThan(200);
        for (const item of leaves) {
            expect(['primitive', 'semantic']).toContain(item.layer);
            expect(item.type).toBeDefined();
        }
    });

    it('should hold the ramps, the space scale and no component group', () => {
        const palette = DEFAULT_TOKENS.palette as TokenTree;
        const space = (DEFAULT_TOKENS.scale as TokenTree).space as TokenTree;

        for (const ramp of ['neutral', 'blue', 'green', 'amber', 'red', 'violet', 'teal']) {
            expect(Object.keys(palette[ramp] as TokenTree)).toHaveLength(11);
        }
        expect(palette.white).toBe('#ffffff');
        expect(palette.black).toBe('#000000');
        expect(Object.values(space)).toEqual(['0px', '2px', '4px', '8px', '12px', '16px', '24px', '32px', '48px', '64px', '96px']);
        expect(DEFAULT_LEAVES.some((item) => item.layer === 'component')).toBe(false);
    });

    it('should give each tone base, soft and on', () => {
        const color = DEFAULT_TOKENS.color as TokenTree;

        for (const tone of ['neutral', 'accent', 'danger', 'warning', 'success', 'info']) {
            expect(Object.keys(color[tone] as TokenTree).sort()).toEqual(['base', 'on', 'soft']);
        }
    });

    it('should give each text role family, size, weight and leading', () => {
        const text = DEFAULT_TOKENS.text as TokenTree;

        expect(Object.keys(text)).toEqual(['display', 'title', 'heading', 'body', 'label', 'caption', 'code']);
        for (const role of Object.values(text)) {
            expect(Object.keys(role as TokenTree).sort()).toEqual(['family', 'leading', 'size', 'weight']);
        }
    });

    it('should express spacing as calc over one scale step and the density factor', () => {
        const space = DEFAULT_TOKENS.space as TokenTree;
        const density = DEFAULT_TOKENS.density as TokenTree;

        for (const group of ['inset', 'gap', 'stack']) {
            for (const size of ['sm', 'md', 'lg']) {
                expect(((space[group] as TokenTree)[size] as string)).toMatch(
                    /^calc\(\{scale\.space\.\d+\} \* \{density\.factor\}\)$/
                );
            }
        }
        expect(density).toEqual({ factor: '1', compact: '0.75', comfortable: '1', spacious: '1.25' });
    });

    it('should derive types from the path', () => {
        const type = (path: string): TokenType | undefined => DEFAULT_LEAVES.find((item) => item.path === path)?.type;

        expect(type('font.weight.bold')).toBe('fontWeight');
        expect(type('elevation.raised.shadow')).toBe('shadow');
        expect(type('elevation.raised.layer')).toBe('number');
        expect(type('icon.stroke')).toBe('number');
        expect(type('motion.duration.fast')).toBe('duration');
        expect(type('motion.easing.enter')).toBe('easing');
        expect(type('text.body.family')).toBe('fontFamily');
    });

    it('should classify the layer by the first path segment', () => {
        const flat = flattenTokens(tree({ palette: { x: '#fff' }, scale: { y: '1px' }, font: { size: { 1: '1px' } }, color: { z: '#fff' }, button: { radius: '0' } }));

        expect(flat.map((item) => item.layer)).toEqual(['primitive', 'primitive', 'primitive', 'semantic', 'component']);
    });

    it('should take component types from the lookup', () => {
        const flat = flattenTokens(tree({ button: { radius: '{radius.md}' } }), new Map([['button.radius', 'dimension' as const]]));

        expect(flat[0]?.type).toBe('dimension');
        expect(flattenTokens(tree({ button: { radius: '0' } }))[0]?.type).toBeUndefined();
    });

    it('should match the JSON export', () => {
        expect(DEFAULT_TOKENS).toEqual(tokensJson);
    });
});

describe('cssName', () => {
    it('should join the path with dashes and the --ui- prefix', () => {
        expect(cssName('color.text.muted')).toBe('--ui-color-text-muted');
        expect(cssName(['scale', 'space', '3'])).toBe('--ui-scale-space-3');
    });

    it.each(['Color', 'color-text', 'color_text', 'a b', ''])('should reject the name "%s"', (name) => {
        expect(() => cssName(['color', name])).toThrow(TokenNameError);
    });

    it('should carry SUI-THEME-NAME with the path', () => {
        try {
            cssName('color.Text');
            expect.unreachable();
        } catch (error) {
            expect((error as TokenNameError).error).toMatchObject({
                code: 'SUI-THEME-NAME',
                statePath: '$.theme.tokens.color.Text'
            });
        }
    });

    it('should reject capital, dot and dash keys in a tree', () => {
        const errors = validateTokenNames({ Color: { a: '1' }, color: { 'a.b': '1', 'c-d': '1' } });

        expect(errors.map((error) => error.code)).toEqual(['SUI-THEME-NAME', 'SUI-THEME-NAME', 'SUI-THEME-NAME']);
        expect(() => flattenTokens(tree({ 'a.b': '1' }))).toThrow(TokenNameError);
    });

    it('should not let two leaves share a CSS name', () => {
        const names = DEFAULT_LEAVES.map((item) => item.cssName);

        expect(new Set(names).size).toBe(names.length);
    });
});

describe('references', () => {
    it('should split a value into literal and reference parts', () => {
        expect(parseValue('calc({scale.space.3} * {density.factor})')).toEqual([
            { kind: 'text', text: 'calc(' },
            { kind: 'ref', path: 'scale.space.3' },
            { kind: 'text', text: ' * ' },
            { kind: 'ref', path: 'density.factor' },
            { kind: 'text', text: ')' }
        ]);
        expect(parseValue('#fff')).toEqual([{ kind: 'text', text: '#fff' }]);
        expect(parseValue('{Bad Path}')).toEqual([{ kind: 'text', text: '{Bad Path}' }]);
    });

    it('should turn references into live var() forms', () => {
        expect(toCssValue('{palette.blue.600}')).toBe('var(--ui-palette-blue-600)');
        expect(toCssValue('calc({scale.space.3} * {density.factor})')).toBe(
            'calc(var(--ui-scale-space-3) * var(--ui-density-factor))'
        );
        expect(toCssValue('4px')).toBe('4px');
    });

    it('should validate the default tree clean', () => {
        expect(validateReferences(DEFAULT_LEAVES)).toEqual([]);
    });

    it('should report an unknown reference with the state path', () => {
        const errors = validateReferences([leaf('color.accent.base', '{palette.nope.1}', 'semantic')]);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 'SUI-THEME-REF', statePath: '$.theme.tokens.color.accent.base' });
    });

    it('should report a reference to a token that exists only as a group', () => {
        const errors = validateReferences([
            leaf('palette.blue.600', '#2563eb', 'primitive'),
            leaf('color.accent.base', '{palette.blue}', 'semantic')
        ]);

        expect(errors.map((error) => error.code)).toEqual(['SUI-THEME-REF']);
    });

    it('should report each reference against the layer direction', () => {
        const errors = validateReferences([
            leaf('palette.a', '#fff', 'primitive'),
            leaf('palette.b', '{palette.a}', 'primitive'),
            leaf('radius.md', '4px', 'semantic'),
            leaf('button.radius', '{radius.md}', 'component'),
            leaf('color.x', '{button.radius}', 'semantic'),
            leaf('button.pad', '{palette.a}', 'component'),
            leaf('button.gap', '{button.radius}', 'component')
        ]);

        expect(errors.map((error) => error.statePath)).toEqual([
            '$.theme.tokens.palette.b',
            '$.theme.tokens.color.x',
            '$.theme.tokens.button.pad',
            '$.theme.tokens.button.gap'
        ]);
    });

    it('should find a reference inside calc()', () => {
        const errors = validateReferences([leaf('space.inset.sm', 'calc({scale.space.3} * {density.factor})', 'semantic')]);

        expect(errors.map((error) => error.message)).toEqual([
            expect.stringContaining('scale.space.3'),
            expect.stringContaining('density.factor')
        ]);
    });

    it('should report a two-token cycle with its chain', () => {
        const errors = validateReferences([leaf('color.a', '{color.b}', 'semantic'), leaf('color.b', '{color.a}', 'semantic')]);

        expect(errors).toHaveLength(1);
        expect(errors[0]?.message).toContain('color.a -> color.b -> color.a');
        expect(errors[0]?.statePath).toBe('$.theme.tokens.color.a');
    });

    it('should report a three-token cycle with its chain', () => {
        const errors = validateReferences([
            leaf('color.a', '{color.b}', 'semantic'),
            leaf('color.b', '{color.c}', 'semantic'),
            leaf('color.c', '{color.a}', 'semantic')
        ]);

        expect(errors).toHaveLength(1);
        expect(errors[0]?.message).toContain('color.a -> color.b -> color.c -> color.a');
    });

    it('should report a token that references itself', () => {
        const errors = validateReferences([leaf('color.a', '{color.a}', 'semantic')]);

        expect(errors[0]?.message).toContain('color.a -> color.a');
    });
});

describe('validateTokenValue', () => {
    const valid: [TokenType, string][] = [
        ['color', '#fff'],
        ['color', '#ffff'],
        ['color', '#ffffff'],
        ['color', '#ffffff80'],
        ['color', 'rgb(1, 2, 3)'],
        ['color', 'rgba(1, 2, 3, 0.5)'],
        ['color', 'hsl(210, 50%, 40%)'],
        ['color', 'hsla(210, 50%, 40%, 0.5)'],
        ['color', 'transparent'],
        ['dimension', '0'],
        ['dimension', '4px'],
        ['dimension', '1.5rem'],
        ['dimension', '50%'],
        ['dimension', 'calc({scale.space.3} * {density.factor})'],
        ['dimension', 'calc(4px + (2rem - 1px) * 2)'],
        ['number', '2'],
        ['number', '0.75'],
        ['duration', '200ms'],
        ['duration', '0.2s'],
        ['duration', '0ms'],
        ['easing', 'ease-in-out'],
        ['easing', 'cubic-bezier(0.4, 0, 0.2, 1)'],
        ['shadow', 'none'],
        ['shadow', '0 1px 3px 0 rgba(0, 0, 0, 0.1)'],
        ['shadow', '0 1px 3px 0 #000, 0 8px 24px -2px rgba(0, 0, 0, 0.2)'],
        ['fontFamily', "system-ui, 'Segoe UI', sans-serif"],
        ['fontWeight', '400'],
        ['fontWeight', 'bold'],
        ['fontWeight', 'normal']
    ];
    const invalid: [TokenType, string][] = [
        ['color', 'red'],
        ['color', '#ff'],
        ['color', 'rgb(1, 2)'],
        ['dimension', '4'],
        ['dimension', '4em'],
        ['dimension', 'calc(4px +)'],
        ['dimension', 'calc(4px+2px)'],
        ['dimension', 'calc(4px'],
        ['number', '2px'],
        ['duration', '200'],
        ['duration', '0'],
        ['easing', 'bounce'],
        ['easing', 'cubic-bezier(2, 0, 0.2, 1)'],
        ['shadow', '0 1px 3px rgba(0, 0, 0, 0.1)'],
        ['shadow', 'inset'],
        ['fontFamily', 'a; b'],
        ['fontFamily', ''],
        ['fontWeight', '950'],
        ['fontWeight', '1000'],
        ['fontWeight', 'heavy']
    ];

    it.each(valid)('should accept %s "%s"', (type, text) => {
        expect(validateTokenValue(type, text)).toBe(true);
    });

    it.each(invalid)('should reject %s "%s"', (type, text) => {
        expect(validateTokenValue(type, text)).toBe(false);
    });

    it.each(['url(x)', 'a@b', 'a;b', 'expression(1)', 'a{b', 'a}b', '{bad path}', 'URL(x)'])(
        'should reject the injection "%s" in every type',
        (text) => {
            for (const type of ['color', 'dimension', 'number', 'duration', 'easing', 'shadow', 'fontFamily', 'fontWeight'] as const) {
                expect(validateTokenValue(type, text)).toBe(false);
            }
        }
    );

    it('should accept a single reference of the same type and reject a different type', () => {
        expect(validateTokenValue('color', '{palette.blue.600}')).toBe(true);
        expect(validateTokenValue('dimension', '{palette.blue.600}')).toBe(false);
        expect(validateTokenValue('color', '{palette.blue.9999}')).toBe(false);
        expect(validateTokenValue('color', '{x.y}', (path) => (path === 'x.y' ? 'color' : undefined))).toBe(true);
    });

    it('should reject a reference inside a larger non-calc value', () => {
        expect(validateTokenValue('color', 'rgb({a.b}, 0, 0)')).toBe(false);
        expect(validateTokenValue('dimension', '{scale.size.1}px')).toBe(false);
    });
});

describe('validateTokens', () => {
    it('should accept the whole default tree', () => {
        expect(validateTokens(structuredClone(DEFAULT_TOKENS))).toEqual([]);
    });

    it('should accept a sparse tree, with references into the defaults', () => {
        expect(validateTokens({ color: { accent: { base: '{palette.teal.600}' } }, radius: { md: '8px' } })).toEqual([]);
    });

    it('should report an unknown path as SUI-THEME-TOKEN', () => {
        const errors = validateTokens({ color: { nope: '#fff' }, palette: { blue: '#fff' } });

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-THEME-TOKEN', '$.theme.tokens.color.nope'],
            ['SUI-THEME-TOKEN', '$.theme.tokens.palette.blue']
        ]);
    });

    it('should report a wrong or injected value as SUI-THEME-VALUE', () => {
        const errors = validateTokens({ radius: { md: 'url(x)', sm: 'red' }, icon: { stroke: 3 } });

        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-THEME-VALUE', '$.theme.tokens.radius.md'],
            ['SUI-THEME-VALUE', '$.theme.tokens.radius.sm'],
            ['SUI-THEME-VALUE', '$.theme.tokens.icon.stroke']
        ]);
    });

    it('should report a reference of the wrong type as SUI-THEME-VALUE', () => {
        const errors = validateTokens({ radius: { md: '{palette.blue.600}' } });

        expect(errors.map((error) => error.code)).toEqual(['SUI-THEME-VALUE']);
    });

    it('should report names before anything else', () => {
        expect(validateTokens({ Color: {} }).map((error) => error.code)).toEqual(['SUI-THEME-NAME']);
    });

    it('should report a reference cycle created by an overlay value', () => {
        const errors = validateTokens({ color: { focus: '{color.accent.base}', accent: { base: '{color.focus}' } } });

        expect(errors.map((error) => error.code)).toEqual(['SUI-THEME-REF']);
    });

    it('should report a primitive that references a token', () => {
        const errors = validateTokens({ palette: { blue: { 600: '{palette.red.600}' } } });

        expect(errors.map((error) => error.code)).toEqual(['SUI-THEME-REF']);
    });

    it('should know component tokens and their types', () => {
        const components: ComponentToken[] = [{ path: 'button.radius', group: 'button', type: 'dimension', default: '{radius.md}' }];

        expect(validateTokens({ button: { radius: '0' } }, { componentTokens: components })).toEqual([]);
        expect(validateTokens({ button: { radius: 'red' } }, { componentTokens: components })[0]?.code).toBe('SUI-THEME-VALUE');
        expect(validateTokens({ button: { radius: '0' } })[0]?.code).toBe('SUI-THEME-TOKEN');
        expect(validateTokens({ button: { radius: '{color.focus}' } }, { componentTokens: components })[0]?.code).toBe(
            'SUI-THEME-VALUE'
        );
    });

    it('should flag a semantic token that references a component token', () => {
        const components: ComponentToken[] = [{ path: 'button.radius', group: 'button', type: 'dimension', default: '{radius.md}' }];

        const errors = validateTokens({ radius: { md: '{button.radius}' } }, { componentTokens: components });

        expect(errors.map((error) => error.code)).toEqual(['SUI-THEME-REF']);
    });
});

describe('contrast', () => {
    it('should compute black on white as 21:1', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(contrastRatio('rgb(255, 255, 255)', 'hsl(0, 0%, 0%)')).toBeCloseTo(21, 5);
    });

    it('should skip translucent values', () => {
        expect(contrastRatio('rgba(0, 0, 0, 0.5)', '#fff')).toBeUndefined();
        expect(contrastRatio('transparent', '#fff')).toBeUndefined();
        expect(contrastRatio('#00000080', '#fff')).toBeUndefined();
    });

    it('should warn for a failing pair with both paths', () => {
        const effective = mergeOverDefaults({ color: { accent: { base: '#aaaaaa', on: '#ffffff' } } });

        const warnings = checkContrast(effective);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({
            code: 'SUI-THEME-CONTRAST',
            severity: 'warning',
            statePath: '$.theme.tokens.color.accent.base'
        });
        expect(warnings[0]?.message).toContain('$.theme.tokens.color.accent.on');
    });

    it('should follow references to literals and warn on text over surface', () => {
        const effective = mergeOverDefaults({ color: { text: { base: '{palette.neutral.300}' } } });

        expect(checkContrast(effective).map((warning) => warning.statePath)).toEqual(['$.theme.tokens.color.text.base']);
    });

    it('should skip a pair that does not resolve to literals', () => {
        const effective = mergeOverDefaults({ color: { accent: { base: 'rgba(0, 0, 0, 0.1)' }, danger: { on: '{color.nope}' } } });

        expect(checkContrast(effective)).toEqual([]);
    });

    it('should leave the default light tree without warnings', () => {
        expect(checkContrast(DEFAULT_TOKENS)).toEqual([]);
    });
});
