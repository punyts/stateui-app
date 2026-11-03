import { isObject } from '../resolve/merge.js';
import type { JsonValue } from '../types.js';

/** One step of a path pattern: a literal key, `*` (any one key) or `{name}` (any one key, captured as `name`) */
export type PatternStep = { kind: 'literal'; text: string } | { kind: 'any' } | { kind: 'capture'; name: string };

export interface PathPattern {
    source: string;
    /** The steps after `$` */
    steps: PatternStep[];
}

/** A change that matched a pattern: the pattern's concrete path and the captured keys */
export interface PatternMatch {
    path: string;
    captures: Record<string, string>;
}

const STEP = /^[^.\s{}*]+$/;
const CAPTURE = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

/** The steps of an absolute state path after `$` (`$.data.a` is `["data", "a"]`, `$` is `[]`) */
export function pathSteps(path: string): string[] {
    return path === '$' ? [] : path.slice(2).split('.');
}

/** True when `path` is an absolute state path (`$` or `$.` and steps without spaces) */
export function isStatePath(path: string): boolean {
    return path === '$' || (path.startsWith('$.') && path.slice(2).split('.').every((step) => /^[^.\s]+$/.test(step)));
}

/**
 * Reads a pattern (`$.data.tasks.{task}.status`, `$.app.children.*.open`). Undefined when it does not start with `$.`,
 * has an empty step or a step that is not a key, `*` or `{name}`, or captures the same name twice
 */
export function compilePattern(source: string): PathPattern | undefined {
    if (!source.startsWith('$.')) return undefined;
    const steps: PatternStep[] = [];
    const names = new Set<string>();
    for (const text of source.slice(2).split('.')) {
        if (text === '*') {
            steps.push({ kind: 'any' });
            continue;
        }
        const capture = CAPTURE.exec(text);
        if (capture) {
            const name = capture[1] as string;
            if (names.has(name)) return undefined;
            names.add(name);
            steps.push({ kind: 'capture', name });
            continue;
        }
        if (!STEP.test(text)) return undefined;
        steps.push({ kind: 'literal', text });
    }
    return { source, steps };
}

/** The names a pattern captures, in order */
export function captureNames(pattern: PathPattern): string[] {
    return pattern.steps.flatMap((step) => (step.kind === 'capture' ? [step.name] : []));
}

function stepFits(step: PatternStep, key: string, captures: Record<string, string>): boolean {
    if (step.kind === 'literal') return step.text === key;
    if (step.kind === 'capture') captures[step.name] = key;
    return true;
}

/**
 * Matches a change at `path` against a pattern, at, below or above it:
 * - at or below: one match, the pattern's path taken from the change's leading steps;
 * - above (the change replaced a parent): the pattern's remaining steps are looked up in `value`, the value at
 *   `path` after the change; `*` and `{name}` steps expand to its keys, a literal step is kept even when the key is
 *   missing (the change removed it). Matches come in key order.
 */
export function matchPattern(pattern: PathPattern, path: string, value?: JsonValue): PatternMatch[] {
    const steps = pathSteps(path);
    const captures: Record<string, string> = {};
    const shared = Math.min(steps.length, pattern.steps.length);
    for (let index = 0; index < shared; index += 1) {
        if (!stepFits(pattern.steps[index] as PatternStep, steps[index] as string, captures)) return [];
    }
    if (steps.length >= pattern.steps.length) {
        return [{ path: `$.${steps.slice(0, pattern.steps.length).join('.')}`, captures }];
    }

    const matches: PatternMatch[] = [];
    const expand = (index: number, at: string[], current: JsonValue | undefined, found: Record<string, string>): void => {
        if (index === pattern.steps.length) {
            matches.push({ path: `$.${at.join('.')}`, captures: found });
            return;
        }
        const step = pattern.steps[index] as PatternStep;
        if (step.kind === 'literal') {
            const next = isObject(current) && Object.hasOwn(current, step.text) ? current[step.text] : undefined;
            expand(index + 1, [...at, step.text], next, found);
            return;
        }
        if (!isObject(current)) return;
        for (const [key, next] of Object.entries(current)) {
            expand(index + 1, [...at, key], next, step.kind === 'capture' ? { ...found, [step.name]: key } : found);
        }
    };
    expand(steps.length, steps, value, captures);
    return matches;
}

/** Puts captured keys into a path or pattern: `$.data.tasks.{task}.done` with `task: "t1"` */
export function fillCaptures(text: string, captures: Readonly<Record<string, string>>): string {
    return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) =>
        Object.hasOwn(captures, name) ? (captures[name] as string) : whole
    );
}
