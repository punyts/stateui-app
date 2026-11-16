import type { JsonObject, JsonValue } from '../types.js';

/** A record key usable as one path segment */
const SEGMENT = /^[A-Za-z0-9_-]+$/;

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/** One record of a record set: `key` names its copy (`<repeat>.rows.<key>`), `recordKey` is its key in the set */
export interface RecordKey {
    readonly key: string;
    /** The array index for an array, the map key for a map */
    readonly recordKey: string;
}

/**
 * The keys of a `drawRepeat`'s record set in order, each with the key the record has in the set. An array is keyed by
 * each record's `id` (a string or number usable as a path segment) when every record has a distinct one, so a copy
 * keeps its key when records are added before it, and by index otherwise; a map by its own keys. Anything else has no
 * records. The component library's row binder names its copies with it and the dispatcher finds the record of a copy
 * (`<repeat>.rows.<key>`) with it, so the two agree
 */
export function recordKeys(records: JsonValue | undefined): RecordKey[] {
    if (Array.isArray(records)) {
        const ids: string[] = [];
        const seen = new Set<string>();
        for (const record of records) {
            const id = isObject(record) ? record['id'] : undefined;
            const text = typeof id === 'string' || typeof id === 'number' ? String(id) : '';
            if (!SEGMENT.test(text) || seen.has(text)) return records.map((_record, index) => ({ key: String(index), recordKey: String(index) }));
            seen.add(text);
            ids.push(text);
        }
        return ids.map((key, index) => ({ key, recordKey: String(index) }));
    }
    if (isObject(records)) return Object.keys(records).map((key) => ({ key, recordKey: key }));
    return [];
}
