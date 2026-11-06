import { HIDDEN, isArticulationName } from '../core/articulation/index.js';
import { buildError } from '../core/errors/index.js';
import type { BuildError } from '../core/errors/index.js';
import type { ComponentToken } from '../core/theme/index.js';
import { typesOf } from '../core/shape/index.js';
import type { ComponentCategory, ObjectField, PropertyShape, Shape, ValidatorOptions } from '../core/shape/index.js';
import type { ExposedPath, ScannedComponent } from '../core/convention/index.js';
import type { JsonObject, JsonValue, Node } from '../core/types.js';
import type { PatternCatalogEntry } from './patterns.js';
import type { ThemePresetCatalogEntry } from './presets.js';
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
    /** The components its `children` slot accepts; absent when it accepts any */
    childComponents?: string[];
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
    /** The components the slot accepts; absent when it accepts any */
    childComponents?: string[];
}

interface EntryBase {
    name: string;
    size: CatalogSize;
    /** The language codes that have a locale overlay, in code order */
    locales: string[];
    /** A node of the component with its required properties; it passes `validateNode` unless a required slot needs a child */
    example: Node;
}

/** The keys search reads: the category and the purpose phrases. An entry carries each when its file declares it */
export interface SearchKeys {
    category?: ComponentCategory;
    purposes?: string[];
}

/** The catalog entry of a root component */
export interface RootCatalogEntry extends EntryBase, ShapeExtras, SearchKeys {
    tier: 'root';
    tag: string;
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
export interface ComposedCatalogEntry extends EntryBase, SearchKeys {
    tier: 'composed';
    tag: string;
    /** One line from the composed file; absent when the file has none */
    summary?: string;
    tree: Node;
    /** The override paths that are the component's intended interface, in file order; absent when the file lists none */
    exposes?: ExposedPath[];
}

/**
 * The catalog entry of a shape component: a state file only, drawn by a graphics renderer. It has no tag, slots,
 * commands or layout, since nothing mounts it as an element
 */
export interface ShapeCatalogEntry extends EntryBase, SearchKeys {
    tier: 'shape';
    summary: string;
    /** What `validateNode` needs */
    shape: Shape;
    /** The component's own properties */
    own: string[];
    /** The content (`_`) properties, with `map.field` for fields inside map items */
    content: string[];
    events: string[];
    /** The shapes its `children` accept (`drawGroup`); absent when it takes no children */
    childComponents?: string[];
    /** The component tokens the shape declares; absent when it declares none */
    tokens?: ComponentToken[];
}

export type ComponentCatalogEntry = RootCatalogEntry | ComposedCatalogEntry | ShapeCatalogEntry;

/** The content of `catalog.json` */
export interface Catalog {
    /** Every component that built, sorted by name */
    components: ComponentCatalogEntry[];
    /** Every pattern that passed its checks, sorted by kind then name; empty without `patternsDir` */
    patterns: PatternCatalogEntry[];
    /** Every theme preset that passed its checks, sorted by name; empty without `presetsDir` */
    themePresets: ThemePresetCatalogEntry[];
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

function acceptsOf(property: PropertyShape): { childComponents?: string[] } {
    return property.childComponents === undefined ? {} : { childComponents: property.childComponents };
}

function slotsOf(properties: Record<string, PropertyShape>): CatalogSlot[] {
    const slots: CatalogSlot[] = [];
    for (const [name, property] of Object.entries(properties)) {
        if (typesOf(property).includes('node')) slots.push({ name, row: property.row, ...acceptsOf(property) });
        for (const [field, item] of fields(property.items)) {
            if (typesOf(item).includes('node')) slots.push({ name: `${name}.${field}`, row: item.row, ...acceptsOf(item) });
        }
    }
    return slots;
}

/** A UUID that the `fileRef` validator accepts, for samples */
const SAMPLE_FILE_ID = '00000000-0000-0000-0000-000000000000';

/**
 * A value of the type that passes the graphics validators (`color`, `pathData`, `points`, `vector`, `fields`,
 * `fileRef`) set on it; undefined when none of them is set for the type
 */
function graphicsSample(type: string, validators: ValidatorOptions): JsonValue | undefined {
    const { color, pathData, points, vector, fields, fileRef, length } = validators;
    if (type === 'string') {
        if (color !== undefined) return '#000000';
        if (pathData !== undefined) return 'M0 0';
        const image = fileRef?.dataUrl === true ? fileRef.types.find((name) => name.startsWith('image/')) : undefined;
        if (image !== undefined) return `data:${image};base64,`;
    }
    if (type === 'array') {
        if (vector !== undefined) return new Array<number>(vector).fill(0);
        if (points !== undefined) return Array.from({ length: length?.min ?? 0 }, () => [0, 0]);
    }
    if (type === 'object') {
        if (fileRef !== undefined) return { id: SAMPLE_FILE_ID, name: 'file', size: 0, type: fileRef.types[0] as string };
        if (fields !== undefined) {
            const sample: JsonObject = {};
            for (const [name, field] of Object.entries(fields)) {
                if (field.required === true) sample[name] = fieldSample(field);
            }
            return sample;
        }
    }
    return undefined;
}

/** A value that passes one field of the `fields` validator */
function fieldSample(field: ObjectField): JsonValue {
    const validators = field.validators ?? {};
    if (field.values !== undefined) return field.values[0] as JsonValue;
    if (validators.oneOf !== undefined) return validators.oneOf[0] as JsonValue;
    const graphics = graphicsSample(field.type, validators);
    if (graphics !== undefined) return graphics;
    const type = field.type;
    if (type === 'number') return validators.range?.min ?? validators.range?.max ?? 0;
    if (type === 'string') return '';
    if (type === 'boolean') return false;
    if (type === 'array') return [];
    return {};
}

/** A value of the first allowed type; undefined for a `node`, which has no stand-alone value */
function sampleValue(property: PropertyShape): JsonValue | undefined {
    if (property.default !== undefined) return property.default;
    if (property.values !== undefined) return property.values[0];
    const { range, length } = property.validators;
    const type = typesOf(property)[0];
    const graphics = type === undefined ? undefined : graphicsSample(type, property.validators);
    if (graphics !== undefined) return graphics;
    switch (type) {
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

function searchKeysOf(source: SearchKeys): SearchKeys {
    return {
        ...(source.category === undefined ? {} : { category: source.category }),
        ...(source.purposes === undefined ? {} : { purposes: source.purposes })
    };
}

function extrasOf(source: ShapeExtras): ShapeExtras {
    return {
        ...(source.tokens === undefined ? {} : { tokens: source.tokens }),
        ...(source.placement === undefined ? {} : { placement: source.placement }),
        ...(source.childComponents === undefined ? {} : { childComponents: source.childComponents }),
        ...(source.exposes === undefined ? {} : { exposes: source.exposes })
    };
}

/** The entry of a root component that built */
export function rootEntry(component: ScannedComponent, shape: CatalogShape, size: CatalogSize): RootCatalogEntry {
    return {
        name: component.name,
        tier: 'root',
        tag: component.tag as string,
        size,
        summary: shape.summary,
        ...searchKeysOf(shape),
        shape: {
            summary: shape.summary,
            properties: shape.properties,
            shared: shape.shared,
            events: shape.events,
            commands: shape.commands,
            layout: shape.layout,
            ...(shape.childComponents === undefined ? {} : { childComponents: shape.childComponents }),
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

/** The entry of a shape component that built: its summary, search keys, shape, own and content properties, events, the components its `children` accept and tokens */
export function shapeEntry(component: ScannedComponent, shape: CatalogShape, size: CatalogSize): ShapeCatalogEntry {
    return {
        name: component.name,
        tier: 'shape',
        size,
        summary: shape.summary,
        ...searchKeysOf(shape),
        shape: {
            summary: shape.summary,
            properties: shape.properties,
            shared: shape.shared,
            events: shape.events,
            commands: shape.commands,
            layout: shape.layout,
            ...(shape.childComponents === undefined ? {} : { childComponents: shape.childComponents }),
            ...(shape.tokens === undefined ? {} : { tokens: shape.tokens })
        },
        own: Object.keys(shape.properties).filter((name) => !isArticulationName(name)),
        content: contentNames(shape.properties),
        events: shape.events,
        locales: Object.keys(component.locales),
        example: exampleNode(component.name, shape),
        ...(shape.childComponents === undefined ? {} : { childComponents: shape.childComponents }),
        ...(shape.tokens === undefined ? {} : { tokens: shape.tokens })
    };
}

/** The entry of a composed component: the default tree (no `exposes` or search keys), the exposed paths and the search keys from `parseComposed` */
export function composedEntry(
    component: ScannedComponent,
    tree: Node,
    size: CatalogSize,
    exposes: readonly ExposedPath[] = [],
    search: SearchKeys & { summary?: string } = {}
): ComposedCatalogEntry {
    return {
        name: component.name,
        tier: 'composed',
        tag: component.tag as string,
        size,
        ...(search.summary === undefined ? {} : { summary: search.summary }),
        ...searchKeysOf(search),
        tree,
        locales: Object.keys(component.locales),
        example: { component: component.name },
        ...(exposes.length === 0 ? {} : { exposes: exposes.map(({ path, description }) => ({ path, description })) })
    };
}

/** The catalog and the text of `catalog.json`: entries sorted by name, the patterns as given, the list of languages sorted, the theme section, four-space indent, LF newline at the end */
export function emitCatalog(
    entries: readonly ComponentCatalogEntry[],
    theme: ThemeSection,
    patterns: readonly PatternCatalogEntry[] = [],
    themePresets: readonly ThemePresetCatalogEntry[] = []
): { catalog: Catalog; text: string } {
    const components = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const locales = [...new Set(components.flatMap((entry) => entry.locales))].sort();
    const catalog: Catalog = { components, patterns: [...patterns], themePresets: [...themePresets], locales, theme };
    return { catalog, text: `${JSON.stringify(catalog, null, 4)}\n` };
}
