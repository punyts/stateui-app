import { HIDDEN, isArticulationName } from '../core/articulation/index.js';
import { buildError } from '../core/errors/index.js';
import type { BuildError } from '../core/errors/index.js';
import type { ComponentToken } from '../core/theme/index.js';
import { typesOf } from '../core/shape/index.js';
import type { PropertyShape, Shape } from '../core/shape/index.js';
import type { ExposedPath, ScannedComponent } from '../core/convention/index.js';
import type { JsonObject, JsonValue, Node } from '../core/types.js';
import type { ThemeSection } from './theme.js';

/** The size of a component, from the group folder it sits in */
export type CatalogSize = 'atom' | 'molecule' | 'composite';

/**
 * The keys that only the catalog reads. Later stories add them to the shape parser; an entry carries each one
 * when the shape declares it and leaves it out otherwise
 */
export interface ShapeExtras {
    /** The component tokens the component declares: group, path, type and default */
    tokens?: ComponentToken[];
    /** The `placement` shape its children may carry */
    placement?: Record<string, PropertyShape>;
    /** The override paths that are the component's intended interface */
    exposes?: JsonValue;
}

/** A shape as the catalog reads it: the parsed shape plus the optional catalog keys */
export type CatalogShape = Shape & ShapeExtras;

/** A slot: a `node` property, or a `node` field inside the items of a map (`map.field`) */
export interface CatalogSlot {
    name: string;
    /** True when the slot is a row template, where `$row` is legal */
    row: boolean;
}

interface EntryBase {
    name: string;
    tag: string;
    size: CatalogSize;
    /** The language codes that have a locale overlay, in code order */
    locales: string[];
    /** A node of the component with its required properties; it passes `validateNode` unless a required slot needs a child */
    example: Node;
}

/** The catalog entry of a root component */
export interface RootCatalogEntry extends EntryBase, ShapeExtras {
    tier: 'root';
    summary: string;
    /** What `validateNode` needs; the server validates a node against it without a DOM */
    shape: Shape;
    /** The shared properties the component supports: the ones its shape declares, then `hidden` */
    shared: string[];
    /** The component's own properties, without the shared ones */
    own: string[];
    /** The content (`_`) properties, with `map.field` for fields inside map items */
    content: string[];
    slots: CatalogSlot[];
    events: string[];
    commands: string[];
    /** True when a node of this component may carry `layout` */
    layout: boolean;
}

/** The catalog entry of a composed component: its default tree, without the `exposes` key, and the exposed paths */
export interface ComposedCatalogEntry extends EntryBase {
    tier: 'composed';
    tree: Node;
    /** The override paths that are the component's intended interface, in file order; absent when the file lists none */
    exposes?: ExposedPath[];
}

export type ComponentCatalogEntry = RootCatalogEntry | ComposedCatalogEntry;

/** The content of `catalog.json` */
export interface Catalog {
    /** Every component that built, sorted by name */
    components: ComponentCatalogEntry[];
    /** Every language that a component that built has an overlay for, sorted */
    locales: string[];
    /** The theme tokens a node override may set and the shipped overlays; see `buildThemeSection` */
    theme: ThemeSection;
}

const SIZES: Readonly<Record<string, CatalogSize>> = {
    atoms: 'atom',
    molecules: 'molecule',
    composites: 'composite',
    composed: 'composite'
};

/** The size from the group folder: the nearest parent folder named `atoms`, `molecules`, `composites` or `composed` */
export function sizeOf(group: string): CatalogSize | undefined {
    const segments = group.split('/');
    for (let index = segments.length - 1; index >= 0; index -= 1) {
        const size = Object.hasOwn(SIZES, segments[index] as string) ? SIZES[segments[index] as string] : undefined;
        if (size !== undefined) return size;
    }
    return undefined;
}

/** The error for a component whose group folder gives no size */
export function sizeError(component: string, file: string): BuildError {
    return buildError('SUI-BUILD-GROUP', { component, file });
}

function fields(items: PropertyShape['items']): [string, PropertyShape][] {
    return items === undefined || items === 'string' ? [] : Object.entries(items);
}

function contentNames(properties: Record<string, PropertyShape>, prefix = ''): string[] {
    const names: string[] = [];
    for (const [name, property] of Object.entries(properties)) {
        if (property.kind === 'content') names.push(`${prefix}${name}`);
        if (property.items !== undefined && property.items !== 'string') {
            names.push(...contentNames(property.items, `${prefix}${name}.`));
        }
    }
    return names;
}

function slotsOf(properties: Record<string, PropertyShape>): CatalogSlot[] {
    const slots: CatalogSlot[] = [];
    for (const [name, property] of Object.entries(properties)) {
        if (typesOf(property).includes('node')) slots.push({ name, row: property.row });
        for (const [field, item] of fields(property.items)) {
            if (typesOf(item).includes('node')) slots.push({ name: `${name}.${field}`, row: item.row });
        }
    }
    return slots;
}

/** A value of the first allowed type; undefined for a `node`, which has no stand-alone value */
function sampleValue(property: PropertyShape): JsonValue | undefined {
    if (property.default !== undefined) return property.default;
    if (property.values !== undefined) return property.values[0];
    const { range, length } = property.validators;
    switch (typesOf(property)[0]) {
        case 'string':
            return 'x'.repeat(length?.min ?? 1);
        case 'number':
        case 'integer':
            return range?.min ?? 0;
        case 'boolean':
            return false;
        case 'array':
            return [];
        case 'object':
        case 'map':
            return {};
        case 'url':
            return '#';
        case 'icon':
            return 'circle';
        case 'any':
            return '';
        default:
            return undefined;
    }
}

/** True when the sibling the condition names holds (or does not hold) the value that makes the property required */
function conditionHolds(condition: NonNullable<PropertyShape['requiredWhen']>, node: Node, shape: Shape): boolean {
    const actual = node[condition.property] ?? shape.properties[condition.property]?.default;
    const same = (expected: JsonValue): boolean => JSON.stringify(actual) === JSON.stringify(expected);
    return 'equals' in condition ? same(condition.equals) : !same(condition.notEquals);
}

/** The smallest node of a root component: its name, every required property and every property a `requiredWhen` makes required */
export function exampleNode(name: string, shape: Shape): Node {
    const node: Node = { component: name };
    for (const [property, definition] of Object.entries(shape.properties)) {
        if (!definition.required || definition.runtime) continue;
        const value = sampleValue(definition);
        if (value !== undefined) node[property] = value;
    }
    for (const [property, definition] of Object.entries(shape.properties)) {
        if (definition.required || definition.runtime || definition.requiredWhen === undefined) continue;
        if (!conditionHolds(definition.requiredWhen, node, shape)) continue;
        const value = sampleValue(definition);
        if (value !== undefined) node[property] = value;
    }
    return node;
}

function extrasOf(source: ShapeExtras): ShapeExtras {
    return {
        ...(source.tokens === undefined ? {} : { tokens: source.tokens }),
        ...(source.placement === undefined ? {} : { placement: source.placement }),
        ...(source.exposes === undefined ? {} : { exposes: source.exposes })
    };
}

/** The entry of a root component that built */
export function rootEntry(component: ScannedComponent, shape: CatalogShape, size: CatalogSize): RootCatalogEntry {
    return {
        name: component.name,
        tier: 'root',
        tag: component.tag,
        size,
        summary: shape.summary,
        shape: {
            summary: shape.summary,
            properties: shape.properties,
            shared: shape.shared,
            events: shape.events,
            commands: shape.commands,
            layout: shape.layout,
            ...(shape.commandValues === undefined ? {} : { commandValues: shape.commandValues }),
            ...(shape.tokens === undefined ? {} : { tokens: shape.tokens })
        },
        shared: [...shape.shared, HIDDEN],
        own: Object.keys(shape.properties).filter((name) => !isArticulationName(name)),
        content: contentNames(shape.properties),
        slots: slotsOf(shape.properties),
        events: shape.events,
        commands: shape.commands,
        layout: shape.layout,
        locales: Object.keys(component.locales),
        example: exampleNode(component.name, shape),
        ...extrasOf(shape)
    };
}

/** The entry of a composed component: the default tree (no `exposes` key) and the exposed paths from `parseComposed` */
export function composedEntry(
    component: ScannedComponent,
    tree: Node,
    size: CatalogSize,
    exposes: readonly ExposedPath[] = []
): ComposedCatalogEntry {
    return {
        name: component.name,
        tier: 'composed',
        tag: component.tag,
        size,
        tree,
        locales: Object.keys(component.locales),
        example: { component: component.name },
        ...(exposes.length === 0 ? {} : { exposes: exposes.map(({ path, description }) => ({ path, description })) })
    };
}

/** The catalog and the text of `catalog.json`: entries sorted by name, the list of languages sorted, the theme section, four-space indent, LF newline at the end */
export function emitCatalog(entries: readonly ComponentCatalogEntry[], theme: ThemeSection): { catalog: Catalog; text: string } {
    const components = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const locales = [...new Set(components.flatMap((entry) => entry.locales))].sort();
    const catalog: Catalog = { components, locales, theme };
    return { catalog, text: `${JSON.stringify(catalog, null, 4)}\n` };
}
