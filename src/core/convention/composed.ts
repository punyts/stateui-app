import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { resolveNode } from '../resolve/index.js';
import type { ComponentLibrary, DocumentComposed } from '../resolve/index.js';
import { MAX_SUMMARY_LENGTH, categoryError, checkPurposes, isComponentCategory, purposesError } from '../shape/index.js';
import type { ComponentCategory, Shape } from '../shape/index.js';
import { RESERVED_KEYS } from '../types.js';
import type { JsonObject, JsonValue, Node } from '../types.js';

/** The key of a composed tree that lists the override paths that are its intended interface */
export const EXPOSES_KEY = 'exposes';

/** One override path a composed component intends to be changed, with what it does */
export interface ExposedPath {
    path: string;
    description: string;
}

/** Why an exposed path is not accepted */
export interface ExposesIssue {
    /** The offending path; empty when the whole `exposes` value is wrong */
    path: string;
    /** What is wrong, as a short phrase */
    reason: string;
}

export interface ParsedComposed {
    /** The default tree without its `exposes`, `summary`, `category` and `purposes` keys; absent when the file is not a composed tree */
    tree?: Node;
    /** The exposed paths in file order, with their descriptions */
    exposes: ExposedPath[];
    /** One line, at most `MAX_SUMMARY_LENGTH` characters; absent when the file has none */
    summary?: string;
    category?: ComponentCategory;
    /** Three to eight one-line phrases; absent when the file has none */
    purposes?: string[];
    errors: BuildError[];
}

/** Reads and checks the search keys of a composed file with the shape rules; a bad value is an error and left out */
function readSearchKeys(json: JsonObject, file: string): Pick<ParsedComposed, 'summary' | 'category' | 'purposes'> & { errors: BuildError[] } {
    const errors: BuildError[] = [];
    const out: Pick<ParsedComposed, 'summary' | 'category' | 'purposes'> = {};
    const { summary, category, purposes } = json;
    if (summary !== undefined) {
        if (typeof summary === 'string' && summary.trim() !== '' && summary.length <= MAX_SUMMARY_LENGTH && !/[\r\n]/.test(summary)) out.summary = summary;
        else errors.push(buildError('SUI-BUILD-SUMMARY', { file, limit: MAX_SUMMARY_LENGTH }));
    }
    if (category !== undefined) {
        if (isComponentCategory(category)) out.category = category;
        else errors.push(categoryError(file));
    }
    if (purposes !== undefined) {
        const reason = checkPurposes(purposes);
        if (reason === undefined) out.purposes = [...(purposes as string[])];
        else errors.push(purposesError(file, reason));
    }
    return { ...out, errors };
}

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shapeOf(library: ComponentLibrary, component: unknown): Shape | undefined {
    if (typeof component !== 'string' || !Object.hasOwn(library, component)) return undefined;
    const entry = library[component];
    return entry?.tier === 'root' ? entry.shape : undefined;
}

/** True when the path names a property, slot, `children` key or `on` event the node's own shape declares but the node does not hold */
function declared(node: JsonObject, rest: readonly string[], library: ComponentLibrary): boolean {
    const shape = shapeOf(library, node[RESERVED_KEYS.component]);
    if (shape === undefined) return false;
    const [key, next] = rest;
    if (key === undefined) return false;
    if (rest.length === 1) {
        return Object.hasOwn(shape.properties, key) || key === RESERVED_KEYS.children || key === RESERVED_KEYS.on || (key === 'layout' && shape.layout);
    }
    return rest.length === 2 && key === RESERVED_KEYS.on && next !== undefined && shape.events.includes(next);
}

function walk(value: JsonValue | undefined, segments: readonly string[], index: number, library: ComponentLibrary): boolean {
    if (index === segments.length) return true;
    const key = segments[index] as string;
    if (Array.isArray(value)) return /^(?:0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length && walk(value[Number(key)], segments, index + 1, library);
    if (!isObject(value)) return false;
    if (Object.hasOwn(value, key)) return walk(value[key], segments, index + 1, library);
    return declared(value, segments.slice(index), library);
}

/**
 * True when an override path resolves in a resolved default tree: every segment is a key that is there, or the last
 * one (or `on.<event>`) is a property, slot, `children` or event the shape of the nested node declares, as
 * `body.children` is on a form that has no children yet
 */
export function exposedPathResolves(resolved: Node, path: string, library: ComponentLibrary): boolean {
    const segments = path.split('.');
    if (segments.some((segment) => segment === '')) return false;
    return walk(resolved, segments, 0, library);
}

/**
 * Checks an `exposes` value against a default tree: it is an object of override path to a non-empty description,
 * and every path resolves in the tree once nested composed components are expanded. `tree` is the default tree
 * without its `exposes` key; `composed` is the document's own composed entries, when the tree comes from a document
 */
export function checkExposes(
    exposes: JsonValue,
    tree: Node,
    library: ComponentLibrary,
    composed: DocumentComposed = {}
): ExposesIssue[] {
    if (!isObject(exposes)) return [{ path: '', reason: 'must be an object of override path to description' }];
    const resolved = resolveNode(tree, library, composed, { path: '$' }).node;
    const issues: ExposesIssue[] = [];
    for (const [path, description] of Object.entries(exposes)) {
        if (typeof description !== 'string' || description.trim() === '') {
            issues.push({ path, reason: 'needs a description' });
        } else if (!exposedPathResolves(resolved, path, library)) {
            issues.push({ path, reason: 'does not resolve in the default tree' });
        }
    }
    return issues;
}

/** The tree of a composed value without its `exposes` key */
export function withoutExposes(tree: Node): Node {
    const { [EXPOSES_KEY]: _exposes, ...rest } = tree;
    return rest as Node;
}

/**
 * Reads the JSON of a `*.composed.json`: a default tree (an object with a `component` name), its `exposes` map and
 * the search keys `summary`, `category` and `purposes` (checked with the shape rules). The tree comes back without
 * those four keys. A file that is not a tree is `SUI-BUILD-SHAPE`; an `exposes` that is not an
 * object of non-empty descriptions is `SUI-BUILD-EXPOSES`. Whether each path resolves needs the library, so
 * `checkComposedExposes` does that once every component is known
 */
export function parseComposed(json: unknown, file: string): ParsedComposed {
    if (!isObject(json) || typeof json[RESERVED_KEYS.component] !== 'string') {
        return { exposes: [], errors: [buildError('SUI-BUILD-SHAPE', { file, name: '$' })] };
    }
    const { summary: _summary, category: _category, purposes: _purposes, ...treeKeys } = withoutExposes(json as Node);
    const tree = treeKeys as Node;
    const { errors: searchErrors, ...search } = readSearchKeys(json, file);
    const raw = json[EXPOSES_KEY];
    if (raw === undefined) return { tree, exposes: [], ...search, errors: searchErrors };
    if (!isObject(raw)) {
        return { tree, exposes: [], ...search, errors: [...searchErrors, buildError('SUI-BUILD-EXPOSES', { file, key: EXPOSES_KEY, name: 'must be an object of override path to description' })] };
    }
    const exposes: ExposedPath[] = [];
    const errors: BuildError[] = [...searchErrors];
    for (const [path, description] of Object.entries(raw)) {
        if (path === '' || path.split('.').some((segment) => segment === '')) {
            errors.push(buildError('SUI-BUILD-EXPOSES', { file, key: path, name: 'is not a path' }));
        } else if (typeof description !== 'string' || description.trim() === '') {
            errors.push(buildError('SUI-BUILD-EXPOSES', { file, key: path, name: 'needs a description' }));
        } else {
            exposes.push({ path, description });
        }
    }
    return { tree, exposes, ...search, errors };
}

/** `SUI-BUILD-EXPOSES` for each exposed path of a parsed composed file that resolves nowhere in its default tree */
export function checkComposedExposes(parsed: ParsedComposed, library: ComponentLibrary, file: string): BuildError[] {
    if (parsed.tree === undefined || parsed.exposes.length === 0) return [];
    const map: JsonObject = Object.fromEntries(parsed.exposes.map((entry) => [entry.path, entry.description]));
    return checkExposes(map, parsed.tree, library).map((issue) =>
        buildError('SUI-BUILD-EXPOSES', { file, key: issue.path, name: issue.reason })
    );
}
