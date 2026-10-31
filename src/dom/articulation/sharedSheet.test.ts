import { describe, expect, it } from 'vitest';
import { ARTICULATION_LISTS, attributeName } from '../../core/articulation/index.js';
import type { SharedName } from '../../core/articulation/index.js';
import { DEFAULT_LEAVES, cssName, toCssValue } from '../../core/theme/index.js';
import type { TokenLeaf } from '../../core/theme/index.js';
import { densityDependentLeaves, generateSharedSheet } from './sharedSheet.js';

const sheet = generateSharedSheet();

describe('generateSharedSheet', () => {
    const rules: [SharedName, string][] = (['tone', 'size', 'elevation', 'textRole'] as const).flatMap((name) =>
        ARTICULATION_LISTS[name].map((value) => [name, value] as [SharedName, string])
    );

    it.each(rules)('should have a rule for %s=%s', (name, value) => {
        // Arrange
        const selector = `:host([${attributeName(name)}=${value}]) {`;

        // Act
        const found = sheet.includes(selector);

        // Assert
        expect(found).toBe(true);
    });

    it('should map a tone to its three colours', () => {
        // Arrange and Act
        const rule = sheet.slice(sheet.indexOf(':host([tone=danger])'));

        // Assert
        expect(rule).toContain('--tone: var(--ui-color-danger-base);');
        expect(rule).toContain('--tone-soft: var(--ui-color-danger-soft);');
        expect(rule).toContain('--tone-on: var(--ui-color-danger-on);');
    });

    it('should map a size to the control height and icon size', () => {
        // Arrange and Act
        const rule = sheet.slice(sheet.indexOf(':host([size=lg])'));

        // Assert
        expect(rule).toContain('--control-height: var(--ui-size-control-lg);');
        expect(rule).toContain('--icon-size: var(--ui-size-icon-lg);');
    });

    it('should map an elevation to its surface and shadow and a text role to four text properties', () => {
        // Arrange and Act
        const elevation = sheet.slice(sheet.indexOf(':host([elevation=raised])'));
        const role = sheet.slice(sheet.indexOf(':host([text-role=code])'));

        // Assert
        expect(elevation).toContain('--surface: var(--ui-color-surface-raised);');
        expect(elevation).toContain('--shadow: var(--ui-elevation-raised-shadow);');
        for (const part of ['family', 'size', 'weight', 'leading']) {
            expect(role).toContain(`--text-${part}: var(--ui-text-code-${part});`);
        }
    });

    it('should remove a hidden host from layout', () => {
        // Assert
        expect(sheet).toContain(':host([hidden]) {\n    display: none;\n}');
    });

    it('should have no rule for variant', () => {
        // Assert
        expect(sheet).not.toContain('variant');
    });

    it.each(ARTICULATION_LISTS.density)('should set the factor and re-declare every density-dependent token for %s', (density) => {
        // Arrange
        const start = sheet.indexOf(`:host([density=${density}]) {`);
        const rule = sheet.slice(start, sheet.indexOf('\n}', start));
        const expected = DEFAULT_LEAVES.filter((leaf) => leaf.layer === 'semantic' && leaf.value.includes('{density.factor}'));

        // Act
        const redeclared = [...rule.matchAll(/^ {4}(--ui-space-[a-z0-9-]+):/gm)].map((match) => match[1]);

        // Assert
        expect(start).toBeGreaterThanOrEqual(0);
        expect(rule).toContain(`--ui-density-factor: var(--ui-density-${density});`);
        expect(expected.length).toBeGreaterThan(0);
        expect(redeclared).toEqual(expected.map((leaf) => leaf.cssName));
        for (const leaf of expected) expect(rule).toContain(`${leaf.cssName}: ${toCssValue(leaf.value)};`);
    });

    it('should re-declare the nine inset, gap and stack tokens of the default tree', () => {
        // Arrange and Act
        const paths = densityDependentLeaves().map((leaf) => leaf.path);

        // Assert
        expect(paths).toEqual(
            ['inset', 'gap', 'stack'].flatMap((group) => ['sm', 'md', 'lg'].map((step) => `space.${group}.${step}`))
        );
    });

    it('should add a re-declaration to every density rule for a density-dependent token added to the tree', () => {
        // Arrange
        const added: TokenLeaf = {
            path: 'space.page.md',
            cssName: '--ui-space-page-md',
            layer: 'semantic',
            type: 'dimension',
            value: 'calc({scale.space.6} * {density.factor})'
        };

        // Act
        const extended = generateSharedSheet([...DEFAULT_LEAVES, added]);

        // Assert
        expect(sheet).not.toContain('--ui-space-page-md');
        expect(extended.split('--ui-space-page-md: calc(var(--ui-scale-space-6) * var(--ui-density-factor));')).toHaveLength(4);
    });

    it('should name only semantic tokens of the default tree in its var() references outside the density rules', () => {
        // Arrange
        const known = new Set(DEFAULT_LEAVES.map((leaf) => cssName(leaf.path)));
        const articulation = sheet.replace(/:host\(\[density=[a-z]+\]\) \{[^}]*\}\n/g, '');

        // Act
        const used = [...articulation.matchAll(/var\((--ui-[a-z0-9-]+)\)/g)].map((match) => match[1] as string);

        // Assert
        expect(articulation).not.toContain('density');
        expect(used.length).toBeGreaterThan(0);
        expect(used.filter((name) => !known.has(name))).toEqual([]);
        expect(used.filter((name) => /^--ui-(palette|scale|font)-/.test(name))).toEqual([]);
    });

    it('should name only default-tree tokens in the density rules, with scale steps only from the default expressions', () => {
        // Arrange
        const known = new Set(DEFAULT_LEAVES.map((leaf) => cssName(leaf.path)));
        const rules = sheet.match(/:host\(\[density=[a-z]+\]\) \{[^}]*\}/g) ?? [];

        // Act
        const used = rules.flatMap((rule) => [...rule.matchAll(/var\((--ui-[a-z0-9-]+)\)/g)].map((match) => match[1] as string));

        // Assert
        expect(rules).toHaveLength(ARTICULATION_LISTS.density.length);
        expect(used.filter((name) => !known.has(name))).toEqual([]);
        expect(used.filter((name) => /^--ui-(palette|font)-/.test(name))).toEqual([]);
    });
});
