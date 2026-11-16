import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import type { JsonValue } from '../types.js';

type JsonRecord = { [key: string]: JsonValue };

/** The name of a shared shape partial: the file `<name>.json` of the library's shared shape folder */
export const SHAPE_PARTIAL_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** The keys a shared shape partial may hold; each is merged under the same key of the state file */
export const SHAPE_PARTIAL_KEYS = ['properties', 'events', 'tokens'] as const;

/** The shared shape partials by name, each the file text or its already parsed value */
export type ShapePartials = ReadonlyMap<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads one partial: an object of only `properties` (object), `events` (array of strings) and `tokens` (object) */
function readPartial(name: string, source: unknown, file: string, errors: BuildError[]): JsonRecord | undefined {
    const fail = (reason: string): undefined => {
        errors.push(buildError('SUI-BUILD-SHAPE', { file, name: `includes: partial "${name}" ${reason}` }));
        return undefined;
    };
    let value: unknown = source;
    if (typeof source === 'string') {
        try {
            value = JSON.parse(source);
        } catch {
            return fail('is not valid JSON');
        }
    }
    if (!isRecord(value)) return fail('is not an object');
    for (const key of Object.keys(value)) {
        if (!(SHAPE_PARTIAL_KEYS as readonly string[]).includes(key)) return fail(`has the key "${key}"; a partial holds only properties, events and tokens`);
    }
    if (value.properties !== undefined && !isRecord(value.properties)) return fail('has properties that are not an object');
    if (value.tokens !== undefined && !isRecord(value.tokens)) return fail('has tokens that are not an object');
    if (value.events !== undefined && !(Array.isArray(value.events) && value.events.every((event) => typeof event === 'string'))) {
        return fail('has events that are not a list of names');
    }
    return value;
}

/**
 * Merges the entries of the included partials into one keyed section (`properties` or `tokens`) of a state file: the
 * file's own entries first, in their order, then each included entry the file does not declare, in the order of
 * `includes`. An own entry wins over an included one; two partials that declare the same entry are an error
 */
function mergeSection(own: JsonValue | undefined, partials: readonly [string, JsonRecord][], section: 'properties' | 'tokens', file: string, errors: BuildError[]): JsonValue | undefined {
    if (own !== undefined && !isRecord(own)) return own;
    const merged: JsonRecord = { ...(own ?? {}) };
    const owners = new Map<string, string>();
    let added = false;
    for (const [name, partial] of partials) {
        const entries = partial[section];
        if (!isRecord(entries)) continue;
        for (const [key, value] of Object.entries(entries)) {
            const owner = owners.get(key);
            if (owner !== undefined) {
                errors.push(buildError('SUI-BUILD-SHAPE', { file, name: `includes: ${section === 'properties' ? 'property' : 'token'} "${key}" is in the partials "${owner}" and "${name}"` }));
                continue;
            }
            owners.set(key, name);
            if (own !== undefined && Object.prototype.hasOwnProperty.call(own, key)) continue;
            merged[key] = value;
            added = true;
        }
    }
    return own === undefined && !added ? undefined : merged;
}

/**
 * Applies the `includes` of a state file: a list of shared shape partial names, whose `properties`, `events` and
 * `tokens` are merged under the file's own. An own property or token wins over an included one; the events are the
 * file's own followed by each included event it does not list. A list that is not unique partial names, a name with
 * no partial in `partials`, a partial that is not an object of only those three keys, and an entry two partials both
 * declare are `SUI-BUILD-SHAPE` errors on `file`. Returns the state file without `includes`; a file without it is
 * returned as it is
 */
export function applyShapeIncludes(input: JsonRecord, file: string, partials: ShapePartials | undefined, errors: BuildError[]): JsonRecord {
    if (!Object.prototype.hasOwnProperty.call(input, 'includes')) return input;
    const { includes, ...rest } = input;
    const names = Array.isArray(includes) ? includes : undefined;
    const valid =
        names !== undefined &&
        names.every((name) => typeof name === 'string' && SHAPE_PARTIAL_NAME.test(name)) &&
        new Set(names).size === names.length;
    if (!valid) {
        errors.push(buildError('SUI-BUILD-SHAPE', { file, name: 'includes' }));
        return rest;
    }
    const read: [string, JsonRecord][] = [];
    for (const name of names as string[]) {
        if (partials === undefined || !partials.has(name)) {
            errors.push(buildError('SUI-BUILD-SHAPE', { file, name: `includes: unknown partial "${name}"` }));
            continue;
        }
        const partial = readPartial(name, partials.get(name), file, errors);
        if (partial !== undefined) read.push([name, partial]);
    }
    const merged: JsonRecord = { ...rest };
    const properties = mergeSection(rest.properties, read, 'properties', file, errors);
    if (properties !== undefined) merged.properties = properties;
    const tokens = mergeSection(rest.tokens, read, 'tokens', file, errors);
    if (tokens !== undefined) merged.tokens = tokens;
    if (rest.events === undefined || Array.isArray(rest.events)) {
        const events: JsonValue[] = [...((rest.events as JsonValue[] | undefined) ?? [])];
        for (const [, partial] of read) {
            for (const event of (partial.events as string[] | undefined) ?? []) if (!events.includes(event)) events.push(event);
        }
        if (rest.events !== undefined || events.length > 0) merged.events = events;
    }
    return merged;
}
