import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildError } from '../core/errors/index.js';
import { buildFailure } from './failures.js';

const INCLUDE_LINE = /^[ \t]*@include[ \t]+"([^"\n]*)"[ \t]*;[ \t]*$/;
const PARTIAL_NAME = /^[a-z0-9][a-z0-9-]*\.css$/;

/**
 * Replaces each `@include "<name>.css";` line of a component's stylesheet with the text of `<name>.css` from
 * `sharedDir`. The line must hold the include and nothing else. A name that is not a plain `.css` file name, a file
 * that does not exist, and an `@include` inside a partial are `SUI-BUILD-IO` errors located at the include line, and
 * the line is left as it is. Without `sharedDir` no line is touched
 */
export async function inlineIncludes(
    css: string,
    file: string,
    sharedDir: string | undefined,
    errors: BuildError[]
): Promise<string> {
    if (sharedDir === undefined) return css;
    const lines = css.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        const match = INCLUDE_LINE.exec(lines[index] as string);
        if (!match) continue;
        const name = match[1] as string;
        const line = index + 1;
        const column = (lines[index] as string).indexOf('@include') + 1;
        let partial: string | undefined;
        if (PARTIAL_NAME.test(name)) {
            try {
                partial = (await readFile(join(sharedDir, name), 'utf8')).replace(/\r\n?/g, '\n').replace(/\n$/, '');
            } catch {
                partial = undefined;
            }
        }
        if (partial === undefined) {
            errors.push(buildFailure('file', file, `unknown shared stylesheet "${name}" in @include`, line, column));
            continue;
        }
        if (partial.split('\n').some((inner) => INCLUDE_LINE.test(inner))) {
            errors.push(buildFailure('file', file, `shared stylesheet "${name}" must not contain @include`, line, column));
            continue;
        }
        lines[index] = partial;
    }
    return lines.join('\n');
}
