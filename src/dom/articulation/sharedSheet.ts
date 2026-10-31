import { ARTICULATION_LISTS } from '../../core/articulation/index.js';
import { DEFAULT_LEAVES, toCssValue } from '../../core/theme/index.js';
import type { TokenLeaf } from '../../core/theme/index.js';

const TEXT_PARTS = ['family', 'size', 'weight', 'leading'] as const;

/** The surface token each elevation draws on; `flat` stays on the base surface */
const SURFACE: Readonly<Record<(typeof ARTICULATION_LISTS.elevation)[number], string>> = {
    flat: 'base',
    raised: 'raised',
    overlay: 'overlay'
};

const DENSITY_FACTOR_REFERENCE = '{density.factor}';

/** The semantic tokens whose value uses the density factor, in tree order */
export function densityDependentLeaves(leaves: readonly TokenLeaf[] = DEFAULT_LEAVES): TokenLeaf[] {
    return leaves.filter((leaf) => leaf.layer === 'semantic' && leaf.value.includes(DENSITY_FACTOR_REFERENCE));
}

/**
 * One rule per density: the host sets `--ui-density-factor` to the chosen multiplier and re-declares every
 * density-dependent token from its default expression. A `var()` is substituted where the property is declared, so
 * the re-declaration is what makes the `calc()` use the factor set on this host
 */
function densityRule(density: string, leaves: readonly TokenLeaf[]): string {
    const redeclared = leaves.map((leaf) => `    ${leaf.cssName}: ${toCssValue(leaf.value)};`);
    const body = [`    --ui-density-factor: var(--ui-density-${density});`, ...redeclared].join('\n');
    return `:host([density=${density}]) {\n${body}\n}`;
}

function rule(attribute: string, value: string, declarations: readonly [string, string][]): string {
    const body = declarations.map(([name, token]) => `    ${name}: var(${token});`).join('\n');
    return `:host([${attribute}=${value}]) {\n${body}\n}`;
}

/**
 * The shared articulation stylesheet, built from the closed lists. Each attribute `<sui-node>` reflects becomes
 * local custom properties on the host: `tone` gives `--tone`, `--tone-soft` and `--tone-on`; `size` gives
 * `--control-height` and `--icon-size`; `elevation` gives `--surface` and `--shadow`; `textRole` gives
 * `--text-family`, `--text-size`, `--text-weight` and `--text-leading`; `hidden` removes the host from layout.
 * `density` sets `--ui-density-factor` and re-declares the density-dependent `space` tokens on the host, so everything
 * below follows. `variant` has no rule here: a variant is painted by the component's own CSS. The build prepends this text to every root component's CSS, so the tone table lives only here
 */
export function generateSharedSheet(leaves: readonly TokenLeaf[] = DEFAULT_LEAVES): string {
    const rules: string[] = [];
    for (const tone of ARTICULATION_LISTS.tone) {
        rules.push(
            rule('tone', tone, [
                ['--tone', `--ui-color-${tone}-base`],
                ['--tone-soft', `--ui-color-${tone}-soft`],
                ['--tone-on', `--ui-color-${tone}-on`]
            ])
        );
    }
    for (const size of ARTICULATION_LISTS.size) {
        rules.push(
            rule('size', size, [
                ['--control-height', `--ui-size-control-${size}`],
                ['--icon-size', `--ui-size-icon-${size}`]
            ])
        );
    }
    for (const elevation of ARTICULATION_LISTS.elevation) {
        rules.push(
            rule('elevation', elevation, [
                ['--surface', `--ui-color-surface-${SURFACE[elevation]}`],
                ['--shadow', `--ui-elevation-${elevation}-shadow`]
            ])
        );
    }
    for (const role of ARTICULATION_LISTS.textRole) {
        rules.push(
            rule(
                'text-role',
                role,
                TEXT_PARTS.map((part) => [`--text-${part}`, `--ui-text-${role}-${part}`] as [string, string])
            )
        );
    }
    const dependent = densityDependentLeaves(leaves);
    for (const density of ARTICULATION_LISTS.density) rules.push(densityRule(density, dependent));
    rules.push(':host([hidden]) {\n    display: none;\n}');
    return `${rules.join('\n')}\n`;
}
