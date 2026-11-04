import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { isNodeValue, isObject } from '../resolve/merge.js';
import { DOCUMENT_KEYS } from '../types.js';
import type { JsonValue } from '../types.js';

/** The maps whose key order is the display order; an integer-like key in one would be reordered by the engine */
const ORDERED_KEYS: readonly string[] = ['children', 'options', 'columns', 'items', 'steps', 'messages'];

const INTEGER_KEY = /^(0|[1-9][0-9]*)$/;
const MAX_INDEX = 4294967294;

function isIntegerKey(key: string): boolean {
    return INTEGER_KEY.test(key) && Number(key) <= MAX_INDEX;
}

/** The properties a record view reads by position when its node has a `total` (what the logic `query` command writes) */
const POSITIONED_KEYS: readonly string[] = ['records', 'items'];

/** True when the object is a node of a paged record view: a non-negative integer `total` says its records are read by position */
function isPaged(value: Record<string, JsonValue>): boolean {
    const total = value['total'];
    return typeof total === 'number' && Number.isInteger(total) && total >= 0;
}

function wrongType(key: string, statePath: string): BuildError {
    return buildError('SUI-DOC-TYPE', { key, path: statePath, statePath });
}

function isMapOf(value: JsonValue, accepts: (entry: JsonValue) => boolean): boolean {
    return isObject(value) && Object.values(value).every(accepts);
}

/** Top-level keys: only the document keys (`runtime` is not one), each of the right type */
export function checkRoot(document: Record<string, JsonValue>): BuildError[] {
    const errors: BuildError[] = [];
    for (const key of Object.keys(document)) {
        if (!(DOCUMENT_KEYS as readonly string[]).includes(key)) {
            const path = `$.${key}`;
            errors.push(buildError('SUI-DOC-KEY', { key, path, statePath: path }));
        }
    }

    const typed: [string, (value: JsonValue) => boolean][] = [
        ['theme', isObject],
        ['themes', (value) => isMapOf(value, isObject)],
        ['locale', (value) => typeof value === 'string'],
        ['data', isObject],
        ['locales', (value) => isMapOf(value, isObject)],
        ['logic', isObject]
    ];
    for (const [key, fits] of typed) {
        if (Object.hasOwn(document, key) && !fits(document[key] as JsonValue)) errors.push(wrongType(key, `$.${key}`));
    }

    if (!isNodeValue(document['app'])) {
        const path = '$.app';
        errors.push(buildError('SUI-NODE-MISSING', { path, statePath: path }));
    }

    const composed = document['composed'];
    if (Object.hasOwn(document, 'composed')) {
        if (!isObject(composed)) {
            errors.push(wrongType('composed', '$.composed'));
        } else {
            for (const [name, tree] of Object.entries(composed)) {
                if (!isNodeValue(tree)) errors.push(wrongType(name, `$.composed.${name}`));
            }
        }
    }
    return errors;
}

interface Frame {
    value: JsonValue;
    path: string;
    /** True when the object is an ordered map */
    ordered: boolean;
    underData: boolean;
}

/**
 * Finds integer-like keys in every ordered map of the nodes (`children`, `options`, `columns`, `items`, `steps`,
 * `messages`) and in every object under `data`. The same list as E6.2. Iterative, so a deep value cannot overflow.
 *
 * The `records` or `items` of a node that also has an integer `total` are exempt: a paged record view reads them by
 * position, so the key is the position and the order of the keys carries nothing (the `query` command writes them so)
 */
export function checkOrderedKeys(document: Record<string, JsonValue>): BuildError[] {
    const errors: BuildError[] = [];
    const stack: Frame[] = [];
    const push = (value: JsonValue | undefined, path: string, underData: boolean): void => {
        if (value !== undefined) stack.push({ value, path, ordered: false, underData });
    };

    push(document['app'], '$.app', false);
    if (isObject(document['composed'])) {
        for (const [name, tree] of Object.entries(document['composed'])) push(tree, `$.composed.${name}`, false);
    }
    push(document['data'], '$.data', true);

    while (stack.length > 0) {
        const frame = stack.pop() as Frame;
        if (Array.isArray(frame.value)) {
            frame.value.forEach((item, index) =>
                stack.push({ value: item, path: `${frame.path}.${index}`, ordered: false, underData: frame.underData })
            );
        } else if (isObject(frame.value)) {
            for (const [key, item] of Object.entries(frame.value)) {
                const path = `${frame.path}.${key}`;
                if ((frame.ordered || frame.underData) && isIntegerKey(key)) {
                    errors.push(buildError('SUI-DOC-ORDER', { key, path, statePath: path }));
                }
                const positioned = POSITIONED_KEYS.includes(key) && !frame.underData && isPaged(frame.value);
                stack.push({ value: item, path, ordered: ORDERED_KEYS.includes(key) && !positioned, underData: frame.underData });
            }
        }
    }
    return errors.sort((a, b) => (a.statePath as string).localeCompare(b.statePath as string));
}

/** True when the dotted `$.data...` path exists in the data branch; an array is read by index */
export function dataPathExists(data: JsonValue | undefined, target: string): boolean {
    const steps = target.split('.').slice(2);
    let current: JsonValue | undefined = data ?? {};
    for (const step of steps) {
        if (Array.isArray(current)) {
            current = isIntegerKey(step) ? current[Number(step)] : undefined;
        } else if (isObject(current) && Object.hasOwn(current, step)) {
            current = current[step];
        } else {
            return false;
        }
        if (current === undefined) return false;
    }
    return true;
}

/** A value naming `$.server` or a path below it: a link or `on` target, a path in a command value */
const SERVER_PATH = /^\$\.server(\.|$)/;

/**
 * Every string of the document that names `$.server` or a path below it, and every logic `call` command, as
 * `SUI-DOC-SERVER`. Only an app server (Full mode) has a `$.server` branch and answers calls, so a Standalone or
 * Persisted app may use neither
 */
export function checkServerUse(document: Record<string, JsonValue>, mode: string): BuildError[] {
    const errors: BuildError[] = [];
    const stack: { value: JsonValue; path: string }[] = Object.entries(document).map(([key, value]) => ({ value, path: `$.${key}` }));
    while (stack.length > 0) {
        const { value, path } = stack.pop() as { value: JsonValue; path: string };
        if (typeof value === 'string') {
            if (SERVER_PATH.test(value)) errors.push(buildError('SUI-DOC-SERVER', { target: value, name: mode, path, statePath: path }));
        } else if (Array.isArray(value)) {
            value.forEach((item, index) => stack.push({ value: item, path: `${path}.${index}` }));
        } else if (isObject(value)) {
            if (path.startsWith('$.logic.') && value['command'] === 'call') {
                errors.push(buildError('SUI-DOC-SERVER', { target: '"call"', name: mode, path, statePath: path }));
            }
            for (const [key, item] of Object.entries(value)) stack.push({ value: item, path: `${path}.${key}` });
        }
    }
    return errors.sort((a, b) => (a.statePath as string).localeCompare(b.statePath as string));
}
