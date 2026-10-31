import { buildError } from './errors/index.js';
import type { BuildError } from './errors/index.js';
import { RESERVED_KEYS } from './types.js';
import type { AppDocument } from './types.js';

/*
 * The design names the four limits but gives no numbers; these are the chosen closed values.
 * A document over any of them is rejected before any other check runs
 */

/** Most nodes in a document, counting `app` and every composed tree */
export const MAX_NODES = 2000;

/** Most node levels from a tree root (a root is level 1) */
export const MAX_DEPTH = 32;

/** Largest serialised document, in UTF-8 bytes (1 MiB) */
export const MAX_DOCUMENT_BYTES = 1024 * 1024;

/** Largest serialised `data` branch, in UTF-8 bytes (512 KiB) */
export const MAX_DATA_BYTES = 512 * 1024;

const encoder = new TextEncoder();

function byteLength(value: unknown): number | undefined {
    try {
        const json = JSON.stringify(value);
        return json === undefined ? 0 : encoder.encode(json).length;
    } catch {
        return undefined;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNode(value: unknown): value is Record<string, unknown> {
    return isRecord(value) && typeof value[RESERVED_KEYS.component] === 'string';
}

interface Frame {
    value: unknown;
    depth: number;
    path: string;
}

/** Counts nodes and finds the deepest one across the trees, stopping once a limit is passed */
function measureNodes(roots: readonly Frame[]): { count: number; deepest: Frame | undefined } {
    let count = 0;
    let deepest: Frame | undefined;
    const stack: Frame[] = [...roots].reverse();
    while (stack.length > 0) {
        const frame = stack.pop() as Frame;
        const node = isNode(frame.value);
        const depth = node ? frame.depth + 1 : frame.depth;
        if (node) {
            count++;
            if (!deepest || depth > deepest.depth) deepest = { value: frame.value, depth, path: frame.path };
            if (count > MAX_NODES || depth > MAX_DEPTH) return { count, deepest };
        }

        if (isRecord(frame.value)) {
            for (const [key, child] of Object.entries(frame.value)) {
                stack.push({ value: child, depth, path: `${frame.path}.${key}` });
            }
        } else if (Array.isArray(frame.value)) {
            frame.value.forEach((child, index) => stack.push({ value: child, depth, path: `${frame.path}.${index}` }));
        }
    }

    return { count, deepest };
}

/**
 * Checks the closed limits and returns a `SUI-DOC` error for each breach. It reads the document as plain JSON
 * and runs before any other validation. A breach of a byte limit skips the node walk, so an oversized
 * document is never traversed
 */
export function checkLimits(document: AppDocument): BuildError[] {
    const errors: BuildError[] = [];
    const total = byteLength(document);
    if (total === undefined) return [buildError('SUI-DOC-SHAPE')];
    if (total > MAX_DOCUMENT_BYTES) {
        errors.push(buildError('SUI-DOC-LIMIT-BYTES', { actual: total, limit: MAX_DOCUMENT_BYTES }));
    }

    const data = byteLength(document.data) ?? 0;
    if (data > MAX_DATA_BYTES) {
        errors.push(buildError('SUI-DOC-LIMIT-DATA', { actual: data, limit: MAX_DATA_BYTES }));
    }

    if (errors.length > 0) return errors;

    const roots: Frame[] = [{ value: document.app, depth: 0, path: '$.app' }];
    if (isRecord(document.composed)) {
        for (const [name, tree] of Object.entries(document.composed)) {
            roots.push({ value: tree, depth: 0, path: `$.composed.${name}` });
        }
    }

    const { count, deepest } = measureNodes(roots);
    if (count > MAX_NODES) {
        errors.push(buildError('SUI-DOC-LIMIT-NODES', { actual: count, limit: MAX_NODES }));
    }

    if (deepest && deepest.depth > MAX_DEPTH) {
        errors.push(
            buildError('SUI-DOC-LIMIT-DEPTH', {
                actual: deepest.depth,
                limit: MAX_DEPTH,
                path: deepest.path,
                statePath: deepest.path
            })
        );
    }

    return errors;
}
