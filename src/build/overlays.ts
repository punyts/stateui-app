import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildError } from '../core/errors/index.js';
import type { BuildError } from '../core/errors/index.js';
import { isObject } from '../core/resolve/merge.js';
import type { JsonObject } from '../core/types.js';
import { buildFailure } from './failures.js';

/** A component's overlay for one language, as read from `<name>.locale.<code>.json` */
export interface ReadOverlay {
    code: string;
    file: string;
    overlay: JsonObject;
}

/** Reads one overlay file: one JSON object; anything else is a `SUI-BUILD` error on the file */
export async function readOverlay(sourceDir: string, code: string, file: string, errors: BuildError[]): Promise<ReadOverlay | undefined> {
    let text: string;
    try {
        text = await readFile(join(sourceDir, file), 'utf8');
    } catch {
        errors.push(buildFailure('file', file, 'could not be read'));
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        errors.push(buildError('SUI-BUILD-SHAPE', { file, name: 'json' }));
        return undefined;
    }
    if (!isObject(parsed)) {
        errors.push(buildError('SUI-BUILD-SHAPE', { file, name: '$' }));
        return undefined;
    }
    return { code, file, overlay: parsed };
}

/** The errors of an overlay check, each located by the overlay's file */
export function inFile(errors: readonly BuildError[], file: string): BuildError[] {
    return errors.map((error) => ({ ...error, file }));
}

/** The output file name of a component's overlay */
export function overlayFileName(component: string, code: string): string {
    return `${component}.locale.${code}.json`;
}

/** The text of an overlay file in the output: four-space indent, LF newline at the end */
export function emitOverlay(overlay: JsonObject): string {
    return `${JSON.stringify(overlay, null, 4)}\n`;
}
