import Expression from '@punyts/expression';
import type { CompiledExpression } from '@punyts/expression';
import { cloneJson, isObject } from '../resolve/merge.js';
import type { JsonObject, JsonValue } from '../types.js';
import { fillCaptures, isStatePath } from './pattern.js';
import type { LogicHost, LogicResult } from './types.js';

/** A failure while a command runs; the transition commits nothing */
export class LogicError extends Error {}

/** The names an expression or a value reference may use besides captures */
export const SCOPE_NAMES = ['trigger', 'previous', 'result', 'key', 'record'] as const;

/** What expressions and values of one transition read */
export interface Scope {
    read(path: string): JsonValue | undefined;
    /** The value at the trigger's path after the change, or the proposed value for a guard */
    trigger?: JsonValue;
    /** The value at the trigger's path before the change; for a guard, the value the change would replace */
    previous?: JsonValue;
    result?: LogicResult;
    /** The key a `save-data` gave its record, for the commands after it */
    key?: string;
    /** The record a `query` filter looks at; its key is `key` */
    record?: JsonValue;
    captures: Readonly<Record<string, string>>;
    /** The inputs of a decision table, read when it fired */
    inputs?: Readonly<Record<string, JsonValue>>;
}

function entries(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (isObject(value as JsonValue)) return Object.values(value as JsonObject);
    return [];
}

function numbers(value: unknown, field?: unknown): number[] {
    return entries(value)
        .map((item) => (typeof field === 'string' && isObject(item as JsonValue) ? (item as JsonObject)[field] : item))
        .filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

/**
 * The fixed function library of logic expressions. Every function is pure except `now`; a map is read in key order,
 * like an array
 */
export const LOGIC_FUNCTIONS: Readonly<Record<string, (...args: unknown[]) => unknown>> = {
    size: (value) => (typeof value === 'string' || Array.isArray(value) ? value.length : entries(value).length),
    keys: (value) => (isObject(value as JsonValue) ? Object.keys(value as JsonObject) : Array.isArray(value) ? value.map((_, index) => index) : []),
    values: (value) => entries(value),
    sum: (value, field) => numbers(value, field).reduce((total, item) => total + item, 0),
    min: (value, field) => (numbers(value, field).length === 0 ? null : Math.min(...numbers(value, field))),
    max: (value, field) => (numbers(value, field).length === 0 ? null : Math.max(...numbers(value, field))),
    count: (value, field, expected) =>
        entries(value).filter((item) => isObject(item as JsonValue) && (item as JsonObject)[String(field)] === expected).length,
    includes: (value, item) =>
        typeof value === 'string' ? value.includes(String(item)) : entries(value).some((entry) => entry === item),
    first: (value) => entries(value)[0] ?? null,
    last: (value) => entries(value).at(-1) ?? null,
    empty: (value) =>
        value === undefined || value === null || value === '' || (typeof value === 'object' && entries(value).length === 0),
    coalesce: (...args) => args.find((item) => item !== undefined && item !== null && item !== '') ?? null,
    lower: (value) => String(value ?? '').toLowerCase(),
    upper: (value) => String(value ?? '').toUpperCase(),
    trim: (value) => String(value ?? '').trim(),
    join: (value, separator) => entries(value).map((item) => String(item)).join(typeof separator === 'string' ? separator : ', '),
    round: (value, digits) => {
        const factor = 10 ** (typeof digits === 'number' ? digits : 0);
        return Math.round(Number(value) * factor) / factor;
    },
    floor: (value) => Math.floor(Number(value)),
    ceil: (value) => Math.ceil(Number(value)),
    abs: (value) => Math.abs(Number(value)),
    number: (value) => (Number.isFinite(Number(value)) ? Number(value) : null),
    string: (value) => (value === undefined || value === null ? '' : String(value)),
    now: () => new Date().toISOString()
};

const compiled = new Map<string, CompiledExpression>();
const MAX_CACHED = 512;

/** Compiles an expression once; throws `LogicError` when it does not compile */
export function compileExpression(text: string): CompiledExpression {
    const cached = compiled.get(text);
    if (cached) return cached;
    let expression: CompiledExpression;
    try {
        expression = Expression(text);
    } catch (error) {
        throw new LogicError(error instanceof Error ? error.message : String(error));
    }
    if (compiled.size >= MAX_CACHED) compiled.clear();
    compiled.set(text, expression);
    return expression;
}

const PATH_CAPTURE = /(\$\.[^\s'"()\[\],]*?)\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Fills trigger captures into the state paths of an expression: `$.data.promos.{code}.percent` reads the record of the
 * captured key. Only `{name}` steps of a `$.` path with a capture of that name are filled
 */
export function withCaptures(text: string, captures: Readonly<Record<string, string>>): string {
    if (!text.includes('{') || Object.keys(captures).length === 0) return text;
    let previous: string;
    let current = text;
    do {
        previous = current;
        current = current.replace(PATH_CAPTURE, (whole, head: string, name: string) =>
            Object.hasOwn(captures, name) ? `${head}${captures[name] as string}` : whole
        );
    } while (current !== previous);
    return current;
}

function setIn(target: Record<string, unknown>, steps: readonly string[], value: unknown): void {
    let current = target;
    for (const step of steps.slice(0, -1)) {
        if (!isObject(current[step] as JsonValue)) current[step] = {};
        current = current[step] as Record<string, unknown>;
    }
    current[steps[steps.length - 1] as string] = value;
}

/**
 * Runs an expression. State paths (`$.data.x`) are read from the scope; for a path that does not exist the nearest
 * existing parent is read, so `$.data.items.length` still works. `$trigger`, `$previous`, `$result`, `$key`, the
 * captures and a table's inputs are
 * names; functions come from `LOGIC_FUNCTIONS`. Throws `LogicError` on a compile or run error
 */
export function evaluate(text: string, scope: Scope): unknown {
    const expression = compileExpression(withCaptures(text, scope.captures));
    const context: Record<string, unknown> = { ...LOGIC_FUNCTIONS };
    for (const [name, key] of Object.entries(scope.captures)) context[`${name}`] = key;
    for (const [name, input] of Object.entries(scope.inputs ?? {})) context[`${name}`] = input;
    if (scope.trigger !== undefined) context['$trigger'] = scope.trigger;
    if (scope.previous !== undefined) context['$previous'] = scope.previous;
    if (scope.result !== undefined) context['$result'] = scope.result;
    if (scope.key !== undefined) context['$key'] = scope.key;
    if (scope.record !== undefined) context['$record'] = scope.record;

    const read = new Set<string>();
    const paths = expression.variables.filter((name) => name.startsWith('$.')).sort((a, b) => a.length - b.length);
    for (const path of paths) {
        const steps = path.slice(2).split('.');
        let length = steps.length;
        let value: JsonValue | undefined;
        for (; length > 0; length -= 1) {
            const prefix = steps.slice(0, length).join('.');
            if ([...read].some((done) => prefix === done || prefix.startsWith(`${done}.`))) break;
            value = scope.read(`$.${prefix}`);
            if (value !== undefined) {
                setIn(context, steps.slice(0, length), value);
                read.add(prefix);
                break;
            }
        }
    }

    try {
        return expression.execute(context);
    } catch (error) {
        throw new LogicError(error instanceof Error ? error.message : String(error));
    }
}

const TEMPLATE = /\{\{([\s\S]+?)\}\}/g;
const WHOLE_TEMPLATE = /^\{\{([\s\S]+?)\}\}$/;
const NAME_REFERENCE = /^\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[^.\s]+)*)$/;

/** The expressions inside `{{ … }}` of a text */
export function templateExpressions(text: string): string[] {
    return [...text.matchAll(TEMPLATE)].map((match) => (match[1] as string).trim());
}

function toJson(value: unknown): JsonValue {
    if (value === undefined) return null;
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    try {
        return JSON.parse(JSON.stringify(value)) as JsonValue;
    } catch {
        throw new LogicError('an expression gave a value that is not JSON');
    }
}

/** A text with `{{ … }}`: one whole expression gives its value, text around expressions gives a string */
function template(text: string, scope: Scope): JsonValue {
    const whole = WHOLE_TEMPLATE.exec(text);
    if (whole && templateExpressions(text).length === 1) return toJson(evaluate((whole[1] as string).trim(), scope));
    return text.replace(TEMPLATE, (_, body: string) => {
        const value = evaluate(body.trim(), scope);
        return value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    });
}

function pathValue(value: JsonValue | undefined, steps: readonly string[]): JsonValue | undefined {
    let current = value;
    for (const step of steps) {
        if (!isObject(current) && !Array.isArray(current)) return undefined;
        current = (current as Record<string, JsonValue>)[step];
    }
    return current;
}

/** The value of a `$name` reference, or undefined when the name is not in the scope */
function named(name: string, steps: readonly string[], scope: Scope): JsonValue | undefined {
    if (name === 'trigger') return pathValue(scope.trigger, steps);
    if (name === 'previous') return pathValue(scope.previous, steps);
    if (name === 'result') return pathValue(scope.result as JsonValue | undefined, steps);
    if (name === 'key') return scope.key;
    if (name === 'record') return pathValue(scope.record, steps);
    if (Object.hasOwn(scope.captures, name)) return scope.captures[name];
    if (scope.inputs !== undefined && Object.hasOwn(scope.inputs, name)) return pathValue(scope.inputs[name], steps);
    throw new LogicError(`$${name} is not a name of this transition`);
}

/**
 * A target or source path of a command: captures filled in, `{{ … }}` evaluated, then a node reference resolved by
 * the host. Throws `LogicError` when the result is not a state path
 */
export function resolvePath(text: string, scope: Scope, host: LogicHost): string {
    const filled = fillCaptures(text, scope.captures);
    const expanded = filled.includes('{{') ? String(template(filled, scope)) : filled;
    if (expanded.startsWith('^')) {
        const path = host.resolve?.(expanded);
        if (path === undefined) throw new LogicError(`${expanded} does not resolve`);
        return path;
    }
    if (!isStatePath(expanded)) throw new LogicError(`${expanded} is not a state path`);
    return expanded;
}

/** The values of a form's fields keyed by child key, as the form's `submitted` event carries them */
function formValues(reference: string, scope: Scope, host: LogicHost): JsonValue {
    const path = resolvePath(reference, scope, host);
    const fields = host.fields?.(path);
    if (fields === undefined) throw new LogicError(`${reference} is not a form`);
    const values: JsonObject = {};
    for (const [key, valuePath] of Object.entries(fields)) values[key] = cloneJson(scope.read(valuePath) ?? null);
    return values;
}

/**
 * The value of a command:
 * - a string `$.path` or `^node.path` is read when the command runs; `$trigger`, `$previous`, `$result`, `$key`,
 *   captures (`$task`) and a table's inputs are names, with steps below them (`$trigger.name`);
 * - a string with `{{ … }}` is evaluated;
 * - `{ "form": ref }`, `{ "record": path }` and `{ "pick": { … } }` are sources;
 * - other arrays and objects are resolved member by member; anything else is a literal
 */
export function resolveValue(value: JsonValue, scope: Scope, host: LogicHost): JsonValue {
    if (typeof value === 'string') {
        if (value.includes('{{')) return template(value, scope);
        if (value.startsWith('$.') || value.startsWith('^')) return cloneJson(scope.read(resolvePath(value, scope, host)) ?? null);
        const reference = NAME_REFERENCE.exec(value);
        if (reference) {
            const steps = (reference[2] as string) === '' ? [] : (reference[2] as string).slice(1).split('.');
            return cloneJson(named(reference[1] as string, steps, scope) ?? null);
        }
        return value;
    }
    if (Array.isArray(value)) return value.map((item) => resolveValue(item, scope, host));
    if (!isObject(value)) return value;

    const keys = Object.keys(value);
    if (keys.length === 1) {
        const [source] = keys as [string];
        const argument = value[source] as JsonValue;
        if (source === 'form' && typeof argument === 'string') return formValues(argument, scope, host);
        if (source === 'record' && typeof argument === 'string') {
            return cloneJson(scope.read(resolvePath(argument, scope, host)) ?? null);
        }
        if (source === 'pick' && isObject(argument)) return resolveValue(argument, scope, host);
    }
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) result[key] = resolveValue(item, scope, host);
    return result;
}

/** An `if` condition: true when the expression's value is truthy */
export function condition(text: string, scope: Scope): boolean {
    const source = WHOLE_TEMPLATE.exec(text.trim());
    return Boolean(evaluate(source ? (source[1] as string).trim() : text, scope));
}
