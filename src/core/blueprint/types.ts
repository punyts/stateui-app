import type { ExposedPath } from '../convention/composed.js';
import type { LogicDocument } from '../logic/types.js';
import type { ComponentCategory } from '../shape/categories.js';
import type { ValidatorOptions } from '../shape/types.js';
import type { OverlayKind } from '../theme/overlays/types.js';
import type { JsonObject, JsonValue, Node } from '../types.js';

/** The roots of the owner tree that hold build-time parts and the owner's data, each keyed by part name */
export const PART_KINDS = ['apps', 'themes', 'logic', 'models', 'data', 'components', 'patterns'] as const;

export type PartKind = (typeof PART_KINDS)[number];

/** A part of the owner named by its kind and name; the storing adapter adds the immutable `id` */
export interface PartRef {
    kind: PartKind;
    name: string;
}

/** The types a model field, a logic module param or a screen param can have: a subset of `PROPERTY_TYPES` */
export const FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'any', 'url'] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** A typed value declaration, as a component property is typed: a model field, a module param or a screen param */
export interface FieldDeclaration {
    type: FieldType;
    default?: JsonValue;
    /** Meaningful when there is no default */
    required?: boolean;
    /** The library's closed validator set */
    validators?: ValidatorOptions;
}

export type ParamDeclaration = FieldDeclaration;

/** An app name binds an owner dataset */
export interface DatasetBinding {
    dataset: string;
}

/** An app name holds each persona's own records of a model */
export interface PersonaBinding {
    model: string;
    scope: 'persona';
}

export type DataBinding = DatasetBinding | PersonaBinding;

/** One owner logic module an app uses, with the values of its params */
export interface ModuleUse {
    params?: JsonObject;
}

/** The owner parts an app uses; owner paths appear only here */
export interface BlueprintUses {
    /** The themes the app offers; the first is the default */
    themes?: string[];
    /** Binding name (`$.data.{name}`) to dataset or persona model */
    data?: Record<string, DataBinding>;
    /** Module name to its param values */
    logic?: Record<string, ModuleUse>;
}

/** One screen: shown in the shell's `outlet` */
export interface BlueprintScreen {
    title?: string;
    params?: Record<string, ParamDeclaration>;
    root: Node;
    /** Overlays of the screen's content by language code, relative to the screen's root */
    locales?: Record<string, JsonObject>;
}

/** An app definition: its own nodes and logic plus references to the owner's parts */
export interface AppBlueprint {
    title?: string;
    uses?: BlueprintUses;
    /** The screen shown first; a key of `screens` */
    start: string;
    /** The frame around every screen, with one `outlet` node */
    shell: Node;
    screens: Record<string, BlueprintScreen>;
    /** The app's own units, which may touch its screens */
    logic?: LogicDocument;
    /** Locale name to messages */
    locales?: Record<string, JsonObject>;
}

/** One named overlay of a theme part */
export interface ThemePartOverlay {
    kind: OverlayKind;
    /** Sparse tokens within the groups `KIND_GROUPS` allows for the kind */
    tokens: JsonObject;
}

/** A named theme: base tokens and overlays by name */
export interface ThemePart {
    tokens: JsonObject;
    overlays?: Record<string, ThemePartOverlay>;
}

/** A dataset a module needs, by the model its records follow */
export interface ModuleNeed {
    model: string;
}

/** Reusable logic over data: it names no node, declares the data it needs and the params it takes */
export interface LogicModule extends LogicDocument {
    needs: Record<string, ModuleNeed>;
    params: Record<string, ParamDeclaration>;
}

/** The shape of records: fields in order */
export interface ModelPart {
    fields: Record<string, FieldDeclaration>;
}

/** The owner's records, keyed by record key, optionally following a model */
export interface DatasetPart {
    model?: string;
    records: Record<string, JsonObject>;
}

/** An owner's composed component: a node tree, its exposed paths and the search keys */
export interface ComposedPart {
    tree: Node;
    exposes: ExposedPath[];
    summary?: string;
    category?: ComponentCategory;
    purposes?: string[];
}

/** A place in a pattern where content goes */
export interface PatternSlot {
    path: string;
    description: string;
}

/** A value a pattern takes, written at its paths */
export interface PatternParam {
    type: FieldType;
    default?: JsonValue;
    required?: boolean;
    paths: string[];
    description: string;
}

/** A shell or screen pattern (the `*.pattern.json` format); the kind stands in for a category */
export interface PatternPart {
    kind: 'shell' | 'screen';
    summary: string;
    purposes: string[];
    tree: Node;
    slots: Record<string, PatternSlot>;
    params: Record<string, PatternParam>;
}
