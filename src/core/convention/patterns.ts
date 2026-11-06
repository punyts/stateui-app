import { PATTERN_KINDS, PATTERN_PARAM_TYPES } from '../blueprint/types.js';
import type { PatternKind, PatternParam, PatternParamType, PatternPart, PatternSlot } from '../blueprint/types.js';
import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { resolveNode } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { MAX_SUMMARY_LENGTH, checkPurposes, nodeChildren, normalizePurpose, validateNode } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import { RESERVED_KEYS } from '../types.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import { exposedPathResolves } from './composed.js';

/** The keys of a `*.pattern.json`; `kind` may be left out, the folder names it */
const PATTERN_KEYS = ['kind', 'summary', 'purposes', 'tree', 'slots', 'params'] as const;
const SLOT_KEYS = ['path', 'description'] as const;
const PARAM_KEYS = ['type', 'default', 'required', 'paths', 'description'] as const;

/** The component a shell shows its screens in */
const OUTLET = 'outlet';

/** A state path a `path` param holds, such as `$.data.products` */
const STATE_PATH = /^\$\.[^\s.]+(?:\.[^\s.]+)*$/;

/** What `readPattern` returns: the typed pattern when the file has no problem, and every problem found */
export interface ReadPatternResult {
    pattern?: PatternPart;
    errors: BuildError[];
}

/** A slot of an applied pattern: where in the copied tree content goes */
export interface AppliedSlot {
    name: string;
    path: string;
    description: string;
}

/** What `applyPattern` returns: the copied tree with the values written, its slots, or the errors naming the params */
export interface ApplyPatternResult {
    tree?: Node;
    slots: AppliedSlot[];
    errors: BuildError[];
}

/** A pattern's purposes with where they come from, for the duplicate check across patterns */
export interface PatternPurposes {
    name: string;
    file: string;
    purposes: readonly string[];
}

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNode(value: unknown): value is Node {
    return isObject(value) && typeof value[RESERVED_KEYS.component] === 'string';
}

function oneLine(value: unknown, limit = Infinity): value is string {
    return typeof value === 'string' && value.trim() !== '' && value.length <= limit && !/[\r\n]/.test(value);
}

function isTreePath(value: unknown): value is string {
    return typeof value === 'string' && value !== '' && value.split('.').every((segment) => segment !== '');
}

function quoted(keys: readonly string[]): string {
    return keys.map((key) => `"${key}"`).join(', ');
}

/** True when a value fits a param type */
export function fitsParamType(type: PatternParamType, value: JsonValue | undefined): boolean {
    switch (type) {
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'path':
            return typeof value === 'string' && STATE_PATH.test(value);
    }
}

function isParamType(value: unknown): value is PatternParamType {
    return typeof value === 'string' && (PATTERN_PARAM_TYPES as readonly string[]).includes(value);
}

class PatternReader {
    readonly errors: BuildError[] = [];

    constructor(private readonly file: string) {}

    problem(path: string, reason: string): void {
        this.errors.push(buildError('SUI-PATTERN-SHAPE', { file: this.file, path, reason }));
    }

    unknownKeys(value: JsonObject, allowed: readonly string[], path: string): void {
        for (const key of Object.keys(value)) {
            if (!allowed.includes(key)) this.problem(`${path}.${key}`, `unknown key (the keys here are ${quoted(allowed)})`);
        }
    }

    slots(value: unknown): Record<string, PatternSlot> {
        const slots: Record<string, PatternSlot> = {};
        if (value === undefined) return slots;
        if (!isObject(value)) {
            this.problem('$.slots', 'must be an object of slot name to { path, description }');
            return slots;
        }
        for (const [name, slot] of Object.entries(value)) {
            const at = `$.slots.${name}`;
            if (!isObject(slot)) {
                this.problem(at, 'must be an object { path, description }');
                continue;
            }
            this.unknownKeys(slot, SLOT_KEYS, at);
            const before = this.errors.length;
            if (!isTreePath(slot.path)) this.problem(`${at}.path`, 'must be a path in the tree, such as "children.main"');
            if (!oneLine(slot.description)) this.problem(`${at}.description`, 'must be one line of text');
            if (this.errors.length === before) slots[name] = { path: slot.path as string, description: slot.description as string };
        }
        return slots;
    }

    params(value: unknown): Record<string, PatternParam> {
        const params: Record<string, PatternParam> = {};
        if (value === undefined) return params;
        if (!isObject(value)) {
            this.problem('$.params', 'must be an object of param name to { type, default?, required?, paths, description }');
            return params;
        }
        for (const [name, param] of Object.entries(value)) {
            const at = `$.params.${name}`;
            if (!isObject(param)) {
                this.problem(at, 'must be an object { type, default?, required?, paths, description }');
                continue;
            }
            this.unknownKeys(param, PARAM_KEYS, at);
            const before = this.errors.length;
            const { type, required, paths, description } = param;
            if (!isParamType(type)) this.problem(`${at}.type`, `must be one of ${quoted(PATTERN_PARAM_TYPES)}`);
            if (required !== undefined && typeof required !== 'boolean') this.problem(`${at}.required`, 'must be true or false');
            if (!Array.isArray(paths) || paths.length === 0 || !paths.every(isTreePath)) {
                this.problem(`${at}.paths`, 'must list one or more paths in the tree');
            }
            if (!oneLine(description)) this.problem(`${at}.description`, 'must be one line of text');
            if (Object.hasOwn(param, 'default')) {
                if (isParamType(type) && !fitsParamType(type, param.default)) this.problem(`${at}.default`, `does not fit the type "${type}"`);
            } else if (required !== true) {
                this.problem(at, 'needs a "default" or "required": true');
            }
            if (this.errors.length > before) continue;
            params[name] = {
                type: type as PatternParamType,
                ...(Object.hasOwn(param, 'default') ? { default: param.default as JsonValue } : {}),
                ...(required === true ? { required: true } : {}),
                paths: [...(paths as string[])],
                description: description as string
            };
        }
        return params;
    }
}

/**
 * Reads the JSON of a `*.pattern.json`: a `summary` of one line, three to eight `purposes`, a `tree` (a node), and
 * optional `slots` (name to `{ path, description }`) and `params` (name to `{ type, default?, required?, paths,
 * description }`, `type` one of `PATTERN_PARAM_TYPES`). `kind` comes from the pattern's folder; a `kind` key in the
 * file must agree. Every problem is a `SUI-PATTERN-SHAPE` naming its path; `pattern` is set only when there is none.
 * Whether the tree's nodes and paths are right needs the library: `checkPattern` does that
 */
export function readPattern(json: unknown, file: string, kind: PatternKind): ReadPatternResult {
    const reader = new PatternReader(file);
    if (!isObject(json)) {
        reader.problem('$', 'must be an object');
        return { errors: reader.errors };
    }
    reader.unknownKeys(json, PATTERN_KEYS, '$');
    if (!(PATTERN_KINDS as readonly string[]).includes(kind)) reader.problem('$.kind', `must be one of ${quoted(PATTERN_KINDS)}`);
    else if (json.kind !== undefined && json.kind !== kind) reader.problem('$.kind', `is "${String(json.kind)}" but the folder is "${kind}"`);
    if (!oneLine(json.summary, MAX_SUMMARY_LENGTH)) reader.problem('$.summary', `must be one line of at most ${MAX_SUMMARY_LENGTH} characters`);
    const purposes = checkPurposes(json.purposes);
    if (purposes !== undefined) reader.problem('$.purposes', purposes);
    if (!isNode(json.tree)) reader.problem('$.tree', 'must be a node with a "component" name');
    const slots = reader.slots(json.slots);
    const params = reader.params(json.params);
    if (reader.errors.length > 0) return { errors: reader.errors };
    return {
        pattern: { kind, summary: json.summary as string, purposes: [...(json.purposes as string[])], tree: json.tree as Node, slots, params },
        errors: []
    };
}

function shapeOf(library: ComponentLibrary, component: string): Shape | undefined {
    const entry = Object.hasOwn(library, component) ? library[component] : undefined;
    return entry?.tier === 'root' ? entry.shape : undefined;
}

/**
 * Checks a read pattern against a component library: every node's component is in the library and every node of a
 * root component passes `validateNode` (a composed node is not opened: the resolver checks its own tree), every slot
 * and param path resolves in the tree as an `exposes` path does, and a shell holds exactly one `outlet` while a
 * screen holds none. Data links are not checked here: a `$.data` path is checked when the pattern is copied into an
 * app and the app is validated. Each problem is a `SUI-PATTERN-SHAPE` naming its path below `$.tree`, `$.slots` or `$.params`
 */
export function checkPattern(pattern: PatternPart, library: ComponentLibrary, file: string): BuildError[] {
    const errors: BuildError[] = [];
    const problem = (path: string, reason: string): void => {
        errors.push(buildError('SUI-PATTERN-SHAPE', { file, path, reason }));
    };
    let outlets = 0;
    const visit = (node: Node, path: string, insideRow: boolean): void => {
        const component = node.component;
        if (component === OUTLET) outlets += 1;
        if (!Object.hasOwn(library, component)) {
            problem(path, `component "${component}" is not in the library`);
            return;
        }
        const shape = shapeOf(library, component);
        if (shape === undefined) return;
        for (const error of validateNode(shape, node, path, { insideRow })) problem(error.statePath ?? path, `${error.code}: ${error.message}`);
        for (const child of nodeChildren(node, path, shape)) {
            if (child.accepts !== undefined && !child.accepts.includes(child.node.component)) {
                problem(child.path, `component "${child.node.component}" is not accepted here; this slot takes ${quoted([...child.accepts])}`);
            }
            visit(child.node as Node, child.path, insideRow || child.row);
        }
    };
    visit(pattern.tree, '$.tree', false);

    if (pattern.kind === 'shell' && outlets !== 1) problem('$.tree', `a shell holds exactly one "${OUTLET}", not ${outlets}`);
    if (pattern.kind === 'screen' && outlets > 0) problem('$.tree', `a screen holds no "${OUTLET}"; the shell has it`);

    const resolved = resolveNode(pattern.tree, library, {}, { path: '$.tree' }).node;
    for (const [name, slot] of Object.entries(pattern.slots)) {
        if (!exposedPathResolves(resolved, slot.path, library)) problem(`$.slots.${name}.path`, `"${slot.path}" does not resolve in the tree`);
    }
    for (const [name, param] of Object.entries(pattern.params)) {
        for (const [index, path] of param.paths.entries()) {
            if (!exposedPathResolves(resolved, path, library)) problem(`$.params.${name}.paths.${index}`, `"${path}" does not resolve in the tree`);
        }
    }
    return errors;
}

/**
 * The names of the components a pattern's tree uses, sorted. A composed node counts as its own name and is not opened;
 * a node of a component the library does not hold counts too, and its children are not walked
 */
export function patternComponents(pattern: Pick<PatternPart, 'tree'>, library: ComponentLibrary): string[] {
    const names = new Set<string>();
    const visit = (node: Node, path: string): void => {
        names.add(node.component);
        const shape = shapeOf(library, node.component);
        if (shape === undefined) return;
        for (const child of nodeChildren(node, path, shape)) visit(child.node as Node, child.path);
    };
    visit(pattern.tree, '$.tree');
    return [...names].sort();
}

/**
 * `SUI-BUILD-PURPOSE-DUPLICATE` for each purpose that repeats one of an earlier pattern (in name order), compared
 * lowercased, trimmed and with inner spaces collapsed, as for components
 */
export function checkPatternPurposes(patterns: readonly PatternPurposes[]): BuildError[] {
    const owners = new Map<string, string>();
    const errors: BuildError[] = [];
    for (const pattern of [...patterns].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        for (const phrase of pattern.purposes) {
            const key = normalizePurpose(phrase);
            const owner = owners.get(key);
            if (owner === undefined) owners.set(key, pattern.name);
            else if (owner !== pattern.name) errors.push(buildError('SUI-BUILD-PURPOSE-DUPLICATE', { key: phrase, component: pattern.name, file: pattern.file, other: owner }));
        }
    }
    return errors;
}

/** Writes a value at a dotted path of a tree copy, making the objects on the way that are not there yet */
function writeAt(tree: JsonObject, path: string, value: JsonValue): void {
    const segments = path.split('.');
    let at: JsonValue = tree;
    for (const [index, segment] of segments.entries()) {
        const last = index === segments.length - 1;
        if (Array.isArray(at)) {
            const position = Number(segment);
            if (last) at[position] = value;
            else at = at[position] as JsonValue;
            continue;
        }
        const object = at as JsonObject;
        if (last) {
            object[segment] = value;
        } else {
            if (!isObject(object[segment]) && !Array.isArray(object[segment])) object[segment] = {};
            at = object[segment] as JsonValue;
        }
    }
}

/**
 * Copies a pattern with its params: each given value, or the param's default, is written at every path of its param
 * in a copy of the tree, and the slots come back as `{ name, path, description }`. An unknown param name, a missing
 * required param and a value that does not fit its param's type are each a `SUI-PATTERN-PARAM` naming the param, and
 * then no tree comes back. The pattern is not changed
 */
export function applyPattern(pattern: PatternPart, values: Readonly<JsonObject> = {}): ApplyPatternResult {
    const errors: BuildError[] = [];
    const known = Object.keys(pattern.params);
    for (const name of Object.keys(values)) {
        if (!Object.hasOwn(pattern.params, name)) {
            const reason = known.length === 0 ? 'is not a param of this pattern, which takes none' : `is not a param of this pattern (its params are ${quoted(known)})`;
            errors.push(buildError('SUI-PATTERN-PARAM', { name, reason }));
        }
    }
    const tree = structuredClone(pattern.tree) as Node;
    for (const [name, param] of Object.entries(pattern.params)) {
        const given = Object.hasOwn(values, name);
        if (!given && param.default === undefined) {
            errors.push(buildError('SUI-PATTERN-PARAM', { name, reason: `is required (type "${param.type}")` }));
            continue;
        }
        const value = given ? values[name] : param.default;
        if (!fitsParamType(param.type, value)) {
            errors.push(buildError('SUI-PATTERN-PARAM', { name, reason: `must be of type "${param.type}"` }));
            continue;
        }
        for (const path of param.paths) writeAt(tree, path, structuredClone(value) as JsonValue);
    }
    const slots = Object.entries(pattern.slots).map(([name, slot]) => ({ name, path: slot.path, description: slot.description }));
    if (errors.length > 0) return { slots, errors };
    return { tree, slots, errors };
}
