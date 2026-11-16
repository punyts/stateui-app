import { cloneJson, isObject } from '../resolve/merge.js';
import type { JsonValue } from '../types.js';
import { pathSteps } from './pattern.js';
import type { LogicWrite } from './types.js';

/** The value at `steps` inside `value` */
export function within(value: JsonValue | undefined, steps: readonly string[]): JsonValue | undefined {
    let current = value;
    for (const step of steps) {
        if (Array.isArray(current)) {
            current = /^(0|[1-9][0-9]*)$/.test(step) ? current[Number(step)] : undefined;
        } else if (isObject(current) && Object.hasOwn(current, step)) {
            current = current[step];
        } else {
            return undefined;
        }
    }
    return current;
}

/** Writes `value` (a delete when undefined) into a copy of `base` at `steps`, creating missing objects on the way */
export function placed(base: JsonValue | undefined, steps: readonly string[], value: JsonValue | undefined): JsonValue | undefined {
    if (steps.length === 0) return value === undefined ? undefined : cloneJson(value);
    const [step, ...rest] = steps as [string, ...string[]];
    if (Array.isArray(base)) {
        const copy = [...base];
        const index = Number(step);
        const next = placed(copy[index], rest, value);
        if (next !== undefined) copy[index] = next;
        return copy;
    }
    const copy: Record<string, JsonValue> = isObject(base) ? { ...base } : {};
    const next = placed(copy[step], rest, value);
    if (next === undefined) delete copy[step];
    else copy[step] = next;
    return copy;
}

/** True when `outer` is `inner` or one of its parents */
export function covers(outer: string, inner: string): boolean {
    return outer === inner || outer === '$' || inner.startsWith(`${outer}.`);
}

/**
 * The state a transition sees while its commands run: the host's values with the transition's writes laid over them
 * in order. Nothing reaches the host until the transition commits `writes`
 */
export class WorkingCopy {
    readonly writes: LogicWrite[] = [];

    constructor(private readonly read: (path: string) => JsonValue | undefined) {}

    get(path: string): JsonValue | undefined {
        let value = this.read(path);
        for (const write of this.writes) {
            if (covers(write.path, path)) {
                value = within(write.value, pathSteps(path).slice(pathSteps(write.path).length));
            } else if (covers(path, write.path)) {
                value = placed(value, pathSteps(write.path).slice(pathSteps(path).length), write.value);
            }
        }
        return value;
    }

    set(path: string, value: JsonValue): void {
        this.writes.push({ path, value: cloneJson(value) });
    }

    delete(path: string): void {
        this.writes.push({ path });
    }
}
