import { BREAKPOINTS } from '../../core/layout/breakpoints.js';
import { ALIGNS, COLLAPSE_BELOW, GAPS, LAYOUTS, LAYOUT_TYPES, REGIONS } from '../../core/layout/lists.js';
import type { LayoutType } from '../../core/layout/lists.js';

/** The flex keyword each `align` value stands for */
const ALIGN_ITEMS: Readonly<Record<(typeof ALIGNS)[number], string>> = {
    start: 'flex-start',
    center: 'center',
    end: 'flex-end',
    stretch: 'stretch'
};

/** The rows and columns of the `region` grid, as the names of its areas */
const REGION_ROWS = [
    ['nw', 'n', 'ne'],
    ['w', 'center', 'e'],
    ['sw', 's', 'se']
] as const;

/** The layout types that stack when their container is below a breakpoint: those whose settings list `collapseBelow` */
const COLLAPSING = LAYOUT_TYPES.filter((type) => 'collapseBelow' in LAYOUTS[type].settings);

/** The container selector of a layout type, optionally narrowed by one `layout-<setting>` attribute */
function container(type: LayoutType, setting?: string, value?: string): string {
    const narrow = setting === undefined ? '' : value === undefined ? `[layout-${setting}]` : `[layout-${setting}="${value}"]`;
    return `[layout-host][layout=${type}]${narrow}`;
}

/** The selector of the elements a layout lays out: `<sui-node>` is `display: contents`, so its child is the item */
function item(type: LayoutType, attribute?: string): string {
    return `[layout=${type}] > sui-node > ${attribute === undefined ? '*' : `[${attribute}]`}`;
}

function block(selector: string, declarations: readonly string[]): string {
    return `${selector} {\n${declarations.map((line) => `    ${line};`).join('\n')}\n}`;
}

function indent(text: string): string {
    return text
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
}

/** The gap of a container whose layout names none, and of a layout host with no layout: siblings never touch unless asked */
export const DEFAULT_GAP = 'var(--ui-space-gap-md)';

/** `gap` maps to the `space.gap` tokens; `none` is no gap */
function gapRules(type: LayoutType): string[] {
    return GAPS.map((gap) => block(container(type, 'gap', gap), [`gap: ${gap === 'none' ? '0' : `var(--ui-space-gap-${gap})`}`]));
}

function alignRules(type: LayoutType): string[] {
    return ALIGNS.map((align) => block(container(type, 'align', align), [`align-items: ${ALIGN_ITEMS[align]}`]));
}

/** `grow` is a number 0 to 12; the sheet styles its whole values */
function growRules(type: LayoutType): string[] {
    const spec = LAYOUTS[type].placement.grow;
    const max = spec?.type === 'number' ? spec.max : 0;
    return Array.from({ length: max + 1 }, (_, grow) => block(item(type, `grow="${grow}"`), [`flex-grow: ${grow}`]));
}

/**
 * In a row with a growing item (`grow` 1 or more), the growing items take the squeeze when space runs short and the
 * others keep their content width, so a label or an amount beside a growing text is never cut. A row without a
 * growing item shrinks every item, as plain flex does
 */
function rowShrinkRules(): string[] {
    const growing = '[grow]:not([grow="0"])';
    const row = `[layout=row]:has(> sui-node > ${growing})`;
    return [
        block(`${row} > sui-node > :is(:not([grow]), [grow="0"])`, ['flex-shrink: 0']),
        block(`[layout=row] > sui-node > ${growing}`, ['min-width: 0'])
    ];
}

/** `[col="1"]` through `[col="12"]` and the other integer fields of a grid */
function gridPlacementRules(): string[] {
    const rules: string[] = [];
    const fields: readonly [string, string, (n: number) => string][] = [
        ['col', 'grid-column-start', (n) => `${n}`],
        ['row', 'grid-row-start', (n) => `${n}`],
        ['span', 'grid-column-end', (n) => `span ${n}`],
        ['row-span', 'grid-row-end', (n) => `span ${n}`]
    ];
    for (const [attribute, property, value] of fields) {
        for (let n = 1; n <= 12; n++) rules.push(block(item('grid', `${attribute}="${n}"`), [`${property}: ${value(n)}`]));
    }
    return rules;
}

/**
 * Below the `sm` breakpoint a row wraps, whether or not it names `wrap`: a phone has no room for a header of a
 * brand, links and a cart on one line, and an item that keeps its width (beside a growing one) would be cut at the
 * edge. An item is never wider than its row. A row that names `collapseBelow` stacks instead, and that rule wins
 */
function rowNarrowRules(): string {
    const rules = [block(container('row'), ['flex-wrap: wrap']), block(item('row'), ['max-inline-size: 100%'])];
    return `@container (width < ${BREAKPOINTS.sm}px) {\n${rules.map(indent).join('\n')}\n}`;
}

/**
 * The container query that stacks a container as one flex column below a breakpoint. Items keep their key order
 * and the grid placement on them stops applying, because flex items ignore it. It restyles the layout host, whose
 * nearest ancestor container is the component host
 */
function collapseRules(type: LayoutType): string[] {
    return COLLAPSE_BELOW.map((name) => {
        const rule = block(container(type, 'collapse-below', name), [
            'display: flex',
            'flex-direction: column',
            'flex-wrap: nowrap',
            'align-items: stretch'
        ]);
        return `@container (width < ${BREAKPOINTS[name]}px) {\n${indent(rule)}\n}`;
    });
}

/**
 * The stylesheet every layout-capable component carries first: the component host and the `layout-host` are both
 * inline-size containers, so a layout host can query its component host and nested hosts can query theirs. The host
 * is a block-level box, because inline-size containment does not apply to an inline box
 */
export function generateLayoutBase(): string {
    return [
        block(':host', ['display: block', 'container-type: inline-size']),
        block('[layout-host]', ['display: block', 'container-type: inline-size']),
        // A layout host whose node sets no layout stacks its children as a column with the default gap. :where keeps
        // the rule at the specificity of [layout-host], so a component's own rule (an empty body hidden) still wins
        block('[layout-host]:where(:not([layout]))', ['display: flex', 'flex-direction: column', `gap: ${DEFAULT_GAP}`])
    ].join('\n');
}

/**
 * The stylesheet of one layout type, built from the closed lists. It is driven by the `layout`, `layout-<setting>`
 * and placement attributes `<sui-node>` writes and by the `--layout-<setting>` custom properties
 */
export function generateLayoutSheet(type: LayoutType): string {
    const rules: string[] = [];
    switch (type) {
        case 'column':
            rules.push(block(container(type), ['display: flex', 'flex-direction: column', `gap: ${DEFAULT_GAP}`]), ...alignRules(type), ...gapRules(type), ...growRules(type));
            break;
        case 'row':
            rules.push(
                block(container(type), ['display: flex', 'flex-direction: row', `gap: ${DEFAULT_GAP}`]),
                block(container(type, 'wrap'), ['flex-wrap: wrap']),
                ...alignRules(type),
                ...gapRules(type),
                ...growRules(type),
                ...rowShrinkRules(),
                rowNarrowRules()
            );
            break;
        case 'grid':
            rules.push(
                block(container(type), [
                    'display: grid',
                    'grid-template-columns: repeat(var(--layout-cols, 1), minmax(0, 1fr))',
                    'grid-template-rows: repeat(var(--layout-rows), auto)',
                    `gap: ${DEFAULT_GAP}`
                ]),
                ...gapRules(type),
                ...gridPlacementRules()
            );
            break;
        case 'region':
            rules.push(
                block(container(type), [
                    'display: grid',
                    'grid-template-columns: auto minmax(0, 1fr) auto',
                    'grid-template-rows: auto minmax(0, 1fr) auto',
                    `grid-template-areas: ${REGION_ROWS.map((row) => `"${row.join(' ')}"`).join(' ')}`,
                    `gap: ${DEFAULT_GAP}`
                ]),
                ...gapRules(type),
                ...REGIONS.map((region) => block(item(type, `region=${region}`), [`grid-area: ${region}`]))
            );
            break;
        case 'adhoc': {
            const fields: readonly [string, string][] = [
                ['x', 'left'],
                ['y', 'top'],
                ['width', 'width'],
                ['height', 'height']
            ];
            const placed = fields.map(([attribute, property]) =>
                indent(block(item(type, attribute), [`${property}: attr(${attribute} type(<length-percentage>))`]))
            );
            // `z` is the stacking order: a window a person brings to the front gets the highest
            placed.push(indent(block(item(type, 'z'), ['z-index: attr(z type(<integer>))'])));
            rules.push(
                block(container(type), ['position: relative']),
                block(item(type), ['position: absolute']),
                `@supports (left: attr(x type(<length-percentage>))) {\n${placed.join('\n')}\n}`
            );
            break;
        }
    }
    if (COLLAPSING.includes(type)) rules.push(...collapseRules(type));
    return rules.join('\n');
}

/** The base sheet followed by the sheet of every layout type; the build prepends this to a layout-capable component */
export function generateLayoutSheets(): string {
    return `${[generateLayoutBase(), ...LAYOUT_TYPES.map(generateLayoutSheet)].join('\n')}\n`;
}
