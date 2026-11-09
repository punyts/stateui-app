import { declarationProblems, isKeyName } from '../blueprint/declaration.js';
import { isPartName } from '../blueprint/names.js';
import type { LogicModule, ParamDeclaration } from '../blueprint/types.js';
import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { cloneJson, isObject } from '../resolve/merge.js';
import { fitsType } from '../shape/fit.js';
import { passesValidators } from '../shape/validators.js';
import type { JsonObject, JsonValue } from '../types.js';
import { readLogic } from './read.js';
import type { LogicDocument } from './types.js';

const MODULE_KEYS = ['needs', 'params', 'machines', 'rules', 'tables', 'computes'];
const UNIT_KINDS = ['machines', 'rules', 'tables', 'computes'] as const;
const NEED_KEYS = ['model'];

/** The separator between a module's name and the name of one of its units (and of its `as` results) once instantiated */
export const MODULE_UNIT_SEPARATOR = ':';

/** `$params.{name}` in an expression or as a whole value */
const PARAM_REFERENCE = /\$params\.([A-Za-z_][A-Za-z0-9_]*)/g;
const WHOLE_PARAM = /^\$params\.([A-Za-z_][A-Za-z0-9_]*)$/;
/** A path into the app node or the screens, anywhere in a string */
const NODE_PATH = /\$\.(app|screens)(?![A-Za-z0-9_])/;
/** A `$.data` path and its first segment: a name, a `{capture}`, `*`, or nothing for `$.data` itself */
const DATA_PATH = /\$\.data(?![A-Za-z0-9_])(?:\.(\{[A-Za-z_][A-Za-z0-9_]*\}|\*|[A-Za-z0-9_-]+))?/g;
/** The keys of a command whose text is a path, where a `^name` node reference may stand */
const PATH_KEYS = ['target', 'from', 'into'];
/** The keys whose whole string is an expression without `{{ }}` */
const EXPRESSION_KEYS = ['if', 'filter'];

export interface ReadModuleResult {
    /** Absent when there are errors (warnings do not drop it) */
    module?: LogicModule;
    errors: BuildError[];
}

function shapeError(path: string, name: string): BuildError {
    return buildError('SUI-LOGIC-SHAPE', { path, name, statePath: path });
}

function isError(error: BuildError): boolean {
    return error.severity !== 'warning';
}

/** The needs of a module: binding names (key names) to `{ model }` (a part name) */
function readNeeds(value: JsonValue | undefined, errors: BuildError[]): void {
    if (!isObject(value)) {
        errors.push(shapeError('$.needs', 'a module needs "needs", the data it reads and writes by binding name: { "bag": { "model": "bag-line" } }'));
        return;
    }
    for (const [name, need] of Object.entries(value)) {
        const at = `$.needs.${name}`;
        if (!isKeyName(name)) errors.push(shapeError(at, `need name "${name}" must be a key name`));
        if (!isObject(need)) {
            errors.push(shapeError(at, 'a need must be { "model" }'));
            continue;
        }
        for (const key of Object.keys(need)) if (!NEED_KEYS.includes(key)) errors.push(shapeError(`${at}.${key}`, `unknown key "${key}"`));
        if (!isPartName(need['model'])) errors.push(shapeError(`${at}.model`, '"model" must be the name of a model part'));
    }
}

/** The params of a module: param names (key names) to typed declarations */
function readParams(value: JsonValue | undefined, errors: BuildError[]): void {
    if (!isObject(value)) {
        errors.push(shapeError('$.params', 'a module needs "params", typed declarations by name ({} for none)'));
        return;
    }
    for (const [name, declaration] of Object.entries(value)) {
        const at = `$.params.${name}`;
        if (!isKeyName(name)) errors.push(shapeError(at, `param name "${name}" must be a key name`));
        for (const problem of declarationProblems(declaration, at)) errors.push(shapeError(problem.path, problem.reason));
    }
}

/** Calls `visit` for every string of a value, with its path and the key it is held under */
function eachString(value: JsonValue | undefined, path: string, key: string, visit: (text: string, path: string, key: string) => void): void {
    if (typeof value === 'string') visit(value, path, key);
    else if (Array.isArray(value)) value.forEach((item, index) => eachString(item, `${path}.${index}`, key, visit));
    else if (isObject(value)) for (const [name, item] of Object.entries(value)) eachString(item, `${path}.${name}`, name, visit);
}

/** True when a path is a state path a table reads or writes: an input, its `path` or `values.keys`, an output, `rows.from` */
function isTablePath(path: string): boolean {
    return /\.tables\.[^.]+\.(?:inputs\.[^.]+(?:\.path|\.values\.keys)?|outputs\.[^.]+|rows\.from)$/.test(path);
}

/** The node, needs and param references of the units, and the commands that run once per instance */
function checkUnits(units: JsonObject, needs: readonly string[], params: readonly string[], errors: BuildError[]): void {
    const declaredNeeds = needs.length === 0 ? 'none' : needs.join(', ');
    eachString(units, '$', '', (text, path, key) => {
        const node = NODE_PATH.exec(text);
        if (node) errors.push(buildError('SUI-MODULE-NODE', { path, target: `$.${node[1] as string}`, statePath: path }));
        else if (text.startsWith('^') && (PATH_KEYS.includes(key) || isTablePath(path))) {
            errors.push(buildError('SUI-MODULE-NODE', { path, target: text, statePath: path }));
        }
        for (const match of text.matchAll(DATA_PATH)) {
            const first = match[1];
            if (first !== undefined && needs.includes(first)) continue;
            const target = first === undefined ? '$.data itself' : `$.data.${first}`;
            errors.push(buildError('SUI-MODULE-NEEDS', { path, target, other: declaredNeeds, statePath: path }));
        }
        for (const match of text.matchAll(PARAM_REFERENCE)) {
            const name = match[1] as string;
            if (!params.includes(name)) errors.push(buildError('SUI-MODULE-PARAM', { name, path, reason: 'the module declares no such param', statePath: path }));
        }
    });
    const commandsOf = (list: JsonValue | undefined, path: string): void => {
        if (!Array.isArray(list)) return;
        list.forEach((command, index) => {
            if (!isObject(command)) return;
            const at = `${path}.${index}`;
            if (command['command'] === 'navigate') errors.push(buildError('SUI-MODULE-NODE', { path: at, target: 'navigate', statePath: at }));
            if (command['command'] === 'increment') {
                errors.push(buildError('SUI-MODULE-ONCE', { command: 'increment', path: at, reason: 'count twice', statePath: at }));
            }
            if (command['command'] === 'save-data' && command['key'] === undefined) {
                errors.push(buildError('SUI-MODULE-ONCE', { command: 'save-data without "key"', path: at, reason: 'add two records', statePath: at }));
            }
        });
    };
    for (const [name, machine] of Object.entries(isObject(units['machines']) ? units['machines'] : {})) {
        if (!isObject(machine) || !Array.isArray(machine['transitions'])) continue;
        machine['transitions'].forEach((transition, index) => {
            if (isObject(transition)) commandsOf(transition['do'], `$.machines.${name}.transitions.${index}.do`);
        });
    }
    for (const [name, rule] of Object.entries(isObject(units['rules']) ? units['rules'] : {})) {
        if (isObject(rule)) commandsOf(rule['do'], `$.rules.${name}.do`);
    }
}

/**
 * Reads a logic module (`{ needs, params, machines?, rules?, tables? }`). The units are read as the logic of a document
 * is (`readLogic`, with paths under `$`); `needs` maps binding names to `{ model }` and `params` holds typed
 * declarations. A module works on its data only: a node reference, a `$.app` or `$.screens` path or `navigate` is
 * `SUI-MODULE-NODE`, a `$.data` path whose first segment is not a need (or is a capture, `*` or nothing) is
 * `SUI-MODULE-NEEDS`, and `$params.{name}` of an undeclared param is `SUI-MODULE-PARAM`. `increment` and `save-data`
 * without `key` are `SUI-MODULE-ONCE` warnings: a module runs once per open instance of an app
 */
export function readModule(json: JsonValue): ReadModuleResult {
    if (!isObject(json)) return { errors: [shapeError('$', 'a logic module must be an object { "needs", "params", "machines"?, "rules"?, "tables"? }')] };
    const errors: BuildError[] = [];
    for (const key of Object.keys(json)) if (!MODULE_KEYS.includes(key)) errors.push(shapeError(`$.${key}`, `unknown key "${key}"`));
    readNeeds(json['needs'], errors);
    readParams(json['params'], errors);
    const units: JsonObject = {};
    for (const kind of UNIT_KINDS) if (json[kind] !== undefined) units[kind] = json[kind] as JsonValue;
    errors.push(...readLogic(units, { root: '$' }).errors);
    const needs = isObject(json['needs']) ? Object.keys(json['needs']) : [];
    const params = isObject(json['params']) ? Object.keys(json['params']) : [];
    checkUnits(units, needs, params, errors);
    if (errors.some(isError)) return { errors };
    return { module: json as unknown as LogicModule, errors };
}

export interface InstantiateModuleOptions {
    /** The module's part name: the prefix of its unit names and `as` results (`cart:totals`) */
    name: string;
    /** The path param errors are reported under (`$.uses.logic.cart.params` in an app); `params` by default */
    paramsPath?: string;
}

export interface InstantiateModuleResult {
    /** The module's units with the params filled in and their names prefixed; empty when there are errors */
    logic: LogicDocument;
    /** The param values the units were filled with, defaults included */
    params: JsonObject;
    errors: BuildError[];
}

/** Why a param value does not fit its declaration, or undefined when it fits */
function misfit(declaration: ParamDeclaration, value: JsonValue): string | undefined {
    if (!fitsType(declaration.type, value)) return `the value must be ${declaration.type}`;
    if (declaration.validators !== undefined && !passesValidators(value, declaration.validators)) return 'the value fails its validators';
    return undefined;
}

/** The values of the params: each given value checked, the defaults filled in, a missing required param reported */
function paramValues(module: LogicModule, given: Readonly<JsonObject>, at: string, errors: BuildError[]): JsonObject {
    const values: JsonObject = {};
    const problem = (name: string, reason: string): void => {
        const path = `${at}.${name}`;
        errors.push(buildError('SUI-MODULE-PARAM', { name, path, reason, ...(at.startsWith('$') ? { statePath: path } : {}) }));
    };
    for (const name of Object.keys(given)) {
        if (!Object.hasOwn(module.params, name)) problem(name, 'the module declares no such param');
    }
    for (const [name, declaration] of Object.entries(module.params)) {
        const value = given[name];
        if (value !== undefined) {
            const reason = misfit(declaration, value);
            if (reason !== undefined) problem(name, reason);
            values[name] = cloneJson(value);
        } else if (declaration.default !== undefined) values[name] = cloneJson(declaration.default);
        else {
            if (declaration.required === true) problem(name, 'it is required and has no value');
            values[name] = null;
        }
    }
    return values;
}

/** The literal of a param value inside an expression: JSON text of a string, number, boolean or null */
function literal(value: JsonValue, name: string, path: string, errors: BuildError[]): string {
    if (value !== null && typeof value === 'object') {
        errors.push(buildError('SUI-MODULE-PARAM', { name, path, reason: 'an array or object param can only stand as a whole value, not inside an expression' }));
        return 'null';
    }
    return JSON.stringify(value);
}

/** Replaces each `$params.{name}` of an expression by the literal of its value */
function fillExpression(text: string, values: Readonly<JsonObject>, path: string, errors: BuildError[]): string {
    return text.replace(PARAM_REFERENCE, (whole: string, name: string) => {
        if (!Object.hasOwn(values, name)) {
            errors.push(buildError('SUI-MODULE-PARAM', { name, path, reason: 'the module declares no such param' }));
            return whole;
        }
        return literal(values[name] as JsonValue, name, path, errors);
    });
}

/**
 * A value with its params filled in: a string that is exactly `$params.{name}` becomes the value itself (any type),
 * the expressions of `if` and `filter` and every `{{ … }}` of a string get the literal of each `$params.{name}`, and
 * the `as` names and `result` triggers get the module prefix. Other text is left as it is
 */
function fill(value: JsonValue, values: Readonly<JsonObject>, prefix: string, path: string, key: string, errors: BuildError[]): JsonValue {
    if (typeof value === 'string') {
        if (key === 'as' || key === 'result') return `${prefix}${value}`;
        const whole = WHOLE_PARAM.exec(value);
        if (whole) {
            const name = whole[1] as string;
            if (Object.hasOwn(values, name)) return cloneJson(values[name] as JsonValue);
            errors.push(buildError('SUI-MODULE-PARAM', { name, path, reason: 'the module declares no such param' }));
            return value;
        }
        if (EXPRESSION_KEYS.includes(key) && !value.trim().startsWith('{{')) return fillExpression(value, values, path, errors);
        return value.replace(/\{\{([\s\S]*?)\}\}/g, (_whole: string, inner: string) => `{{${fillExpression(inner, values, path, errors)}}}`);
    }
    if (Array.isArray(value)) return value.map((item, index) => fill(item, values, prefix, `${path}.${index}`, key, errors));
    if (isObject(value)) {
        const filled: JsonObject = {};
        for (const [name, item] of Object.entries(value)) filled[name] = fill(item, values, prefix, `${path}.${name}`, name, errors);
        return filled;
    }
    return value;
}

/**
 * The units of a module for one app: each param value is checked against its declaration (type and validators; a
 * missing required param and a value for an undeclared one are errors), defaults fill the rest, and every
 * `$params.{name}` is replaced by its value, so the units the engine runs have constant params and no new variable. A
 * string value is JSON-escaped inside an expression. Unit names and `as` results get the prefix `{name}:`, so they never
 * clash with the app's own units or another module's. Errors are `SUI-MODULE-PARAM`; with any, `logic` is empty.
 * The module is expected to have been read with `readModule`
 */
export function instantiateModule(module: LogicModule, given: Readonly<JsonObject>, options: InstantiateModuleOptions): InstantiateModuleResult {
    const errors: BuildError[] = [];
    const values = paramValues(module, given, options.paramsPath ?? 'params', errors);
    const prefix = `${options.name}${MODULE_UNIT_SEPARATOR}`;
    const logic: Record<string, Record<string, JsonValue>> = {};
    for (const kind of UNIT_KINDS) {
        const units = module[kind];
        if (units === undefined) continue;
        const named: Record<string, JsonValue> = {};
        for (const [unit, body] of Object.entries(units)) {
            named[`${prefix}${unit}`] = fill(body as unknown as JsonValue, values, prefix, `$.${kind}.${unit}`, '', errors);
        }
        logic[kind] = named;
    }
    if (errors.length > 0) return { logic: {}, params: values, errors };
    return { logic: logic as unknown as LogicDocument, params: values, errors };
}
