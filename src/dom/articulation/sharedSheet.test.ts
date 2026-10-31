import { describe, expect, it } from 'vitest';
import { ARTICULATION_LISTS, attributeName } from '../../core/articulation/index.js';
import type { SharedName } from '../../core/articulation/index.js';
import { DEFAULT_LEAVES, cssName } from '../../core/theme/index.js';
import { generateSharedSheet } from './sharedSheet.js';

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

    it('should have no rule for variant or density', () => {
        // Assert
        expect(sheet).not.toContain('variant');
        expect(sheet).not.toContain('density');
    });

    it('should name only semantic tokens of the default tree in its var() references', () => {
        // Arrange
        const known = new Set(DEFAULT_LEAVES.map((leaf) => cssName(leaf.path)));

        // Act
        const used = [...sheet.matchAll(/var\((--ui-[a-z0-9-]+)\)/g)].map((match) => match[1] as string);

        // Assert
        expect(used.length).toBeGreaterThan(0);
        expect(used.filter((name) => !known.has(name))).toEqual([]);
        expect(used.filter((name) => /^--ui-(palette|scale|font)-/.test(name))).toEqual([]);
    });
});
