import { describe, expect, it } from 'vitest';
import { BREAKPOINTS } from '../../core/layout/breakpoints.js';
import { COLLAPSE_BELOW, GAPS, LAYOUT_TYPES, REGIONS } from '../../core/layout/lists.js';
import { generateLayoutBase, generateLayoutSheet, generateLayoutSheets } from './layoutSheet.js';

describe('BREAKPOINTS', () => {
    it('should hold the four container widths', () => {
        // Arrange and Act
        const widths = { ...BREAKPOINTS };

        // Assert
        expect(widths).toEqual({ sm: 480, md: 768, lg: 1024, xl: 1280 });
        expect(Object.keys(widths)).toEqual([...COLLAPSE_BELOW]);
    });
});

describe('generateLayoutBase', () => {
    it('should make the component host and the layout host inline-size containers', () => {
        // Arrange and Act
        const base = generateLayoutBase();

        // Assert
        expect(base).toContain(':host {\n    display: block;\n    container-type: inline-size;\n}');
        expect(base).toContain('[layout-host] {\n    display: block;\n    container-type: inline-size;\n}');
    });
});

describe('generateLayoutSheet', () => {
    it.each(GAPS.filter((gap) => gap !== 'none'))('should map layout-gap=%s to its space.gap token', (gap) => {
        // Arrange and Act
        const sheet = generateLayoutSheet('column');

        // Assert
        expect(sheet).toContain(`[layout-host][layout=column][layout-gap="${gap}"] {\n    gap: var(--ui-space-gap-${gap});\n}`);
    });

    it('should map layout-gap=none to no gap', () => {
        // Arrange and Act
        const sheet = generateLayoutSheet('grid');

        // Assert
        expect(sheet).toContain('[layout-gap="none"] {\n    gap: 0;\n}');
    });

    it('should draw grid columns from --layout-cols', () => {
        // Arrange and Act
        const sheet = generateLayoutSheet('grid');

        // Assert
        expect(sheet).toContain('grid-template-columns: repeat(var(--layout-cols, 1), minmax(0, 1fr));');
    });

    it('should have a rule for col, row, span and row-span 1 through 12', () => {
        // Arrange and Act
        const sheet = generateLayoutSheet('grid');

        // Assert
        for (let n = 1; n <= 12; n++) {
            expect(sheet).toContain(`[layout=grid] > sui-node > [col="${n}"] {\n    grid-column-start: ${n};\n}`);
            expect(sheet).toContain(`[layout=grid] > sui-node > [row="${n}"] {\n    grid-row-start: ${n};\n}`);
            expect(sheet).toContain(`[layout=grid] > sui-node > [span="${n}"] {\n    grid-column-end: span ${n};\n}`);
            expect(sheet).toContain(`[layout=grid] > sui-node > [row-span="${n}"] {\n    grid-row-end: span ${n};\n}`);
        }
    });

    it.each(REGIONS)('should put region=%s in its grid area through sui-node', (region) => {
        // Arrange and Act
        const sheet = generateLayoutSheet('region');

        // Assert
        expect(sheet).toContain(`[layout=region] > sui-node > [region=${region}] {\n    grid-area: ${region};\n}`);
    });

    it('should name the nine areas of a region', () => {
        // Arrange and Act
        const sheet = generateLayoutSheet('region');

        // Assert
        expect(sheet).toContain('grid-template-areas: "nw n ne" "w center e" "sw s se";');
    });

    it.each(['grid', 'row', 'region'] as const)('should collapse a %s below every breakpoint with a container query on the width', (type) => {
        // Arrange and Act
        const sheet = generateLayoutSheet(type);

        // Assert
        for (const name of COLLAPSE_BELOW) {
            expect(sheet).toContain(`@container (width < ${BREAKPOINTS[name]}px) {\n    [layout-host][layout=${type}][layout-collapse-below="${name}"] {`);
        }
    });

    it.each(['column', 'adhoc'] as const)('should not collapse a %s', (type) => {
        // Arrange and Act
        const sheet = generateLayoutSheet(type);

        // Assert
        expect(sheet).not.toContain('@container');
    });

    it('should use no custom property in a query condition and only semantic tokens', () => {
        // Arrange and Act
        const sheet = generateLayoutSheets();
        const conditions = [...sheet.matchAll(/@container ([^{]*)\{/g)].map((match) => match[1] ?? '');
        const tokens = [...sheet.matchAll(/var\((--ui-[a-z0-9-]+)/g)].map((match) => match[1]);

        // Assert
        expect(conditions.length).toBe(12);
        expect(conditions.some((condition) => condition.includes('var('))).toBe(false);
        expect(tokens.length).toBeGreaterThan(0);
        expect(tokens.every((token) => /^--ui-space-gap-(sm|md|lg)$/.test(token ?? ''))).toBe(true);
        expect(sheet).not.toMatch(/--ui-(palette|scale|font)-|#[0-9a-f]{3,8}\b|rgb\(/i);
    });

    it('should position adhoc children from their attributes', () => {
        // Arrange and Act
        const sheet = generateLayoutSheet('adhoc');

        // Assert
        expect(sheet).toContain('[layout=adhoc] > sui-node > * {\n    position: absolute;\n}');
        expect(sheet).toContain('left: attr(x type(<length-percentage>));');
        expect(sheet).toContain('height: attr(height type(<length-percentage>));');
    });
});

describe('generateLayoutSheets', () => {
    it('should hold the base sheet and every layout type', () => {
        // Arrange and Act
        const sheet = generateLayoutSheets();

        // Assert
        expect(sheet.startsWith(generateLayoutBase())).toBe(true);
        for (const type of LAYOUT_TYPES) expect(sheet).toContain(generateLayoutSheet(type));
        expect(sheet.endsWith('\n')).toBe(true);
    });
});
