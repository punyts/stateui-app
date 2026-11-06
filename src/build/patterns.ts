import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PATTERN_KINDS } from '../core/blueprint/index.js';
import type { PatternKind, PatternParam, PatternSlot } from '../core/blueprint/index.js';
import { checkPattern, checkPatternPurposes, patternComponents, readPattern } from '../core/convention/index.js';
import type { PatternPurposes } from '../core/convention/index.js';
import { buildError } from '../core/errors/index.js';
import type { BuildError } from '../core/errors/index.js';
import type { ComponentLibrary } from '../core/resolve/index.js';
import type { Node } from '../core/types.js';

/** A lower-case hyphenated folder name, as for component folders */
const FOLDER_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SUFFIX = '.pattern.json';

/** The catalog entry of a pattern that passed every check */
export interface PatternCatalogEntry {
    /** The folder name, lower-case hyphenated */
    name: string;
    kind: PatternKind;
    summary: string;
    purposes: string[];
    tree: Node;
    slots: Record<string, PatternSlot>;
    params: Record<string, PatternParam>;
    /** The names of the components the tree uses, sorted; a composed node is not opened */
    components: string[];
}

/** What `buildPatterns` returns: the entries sorted by kind then name, and every problem found */
export interface BuiltPatterns {
    patterns: PatternCatalogEntry[];
    errors: BuildError[];
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    const paths: string[] = [];
    for (const entry of entries) {
        const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) paths.push(...(await listFiles(root, path)));
        else if (entry.isFile()) paths.push(path);
    }
    return paths.sort();
}

function isPatternKind(value: string): value is PatternKind {
    return (PATTERN_KINDS as readonly string[]).includes(value);
}

/** Where a file sits in the patterns folder, or the reason it is not a pattern file */
function placeOf(file: string): { kind: PatternKind; name: string } | string {
    const segments = file.split('/');
    const [kind, name, base] = segments;
    if (segments.length !== 3 || kind === undefined || name === undefined || base === undefined) {
        return `must be at <kind>/<name>/<name>${SUFFIX}`;
    }
    if (!isPatternKind(kind)) return `is in the folder "${kind}"; the kind folders are ${PATTERN_KINDS.map((k) => `"${k}"`).join(', ')}`;
    if (!FOLDER_NAME.test(name)) return `is in the folder "${name}", which is not a lower-case hyphenated name`;
    if (base !== `${name}${SUFFIX}`) return `must be named "${name}${SUFFIX}" after its folder`;
    return { kind, name };
}

const byKindThenName = (a: PatternCatalogEntry, b: PatternCatalogEntry): number =>
    a.kind !== b.kind ? (a.kind < b.kind ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * Reads a folder of `<kind>/<name>/<name>.pattern.json` files and checks each pattern with `readPattern`,
 * `checkPattern` against the built library and `checkPatternPurposes` across the patterns. A file in the wrong
 * place is `SUI-PATTERN-FILE`; files are named relative to the folder. A pattern with any problem is left out
 */
export async function buildPatterns(patternsDir: string, library: ComponentLibrary): Promise<BuiltPatterns> {
    const errors: BuildError[] = [];
    const read: { entry: PatternCatalogEntry; file: string }[] = [];
    for (const file of await listFiles(patternsDir)) {
        const place = placeOf(file);
        if (typeof place === 'string') {
            errors.push(buildError('SUI-PATTERN-FILE', { file, reason: place }));
            continue;
        }
        let json: unknown;
        try {
            json = JSON.parse(await readFile(join(patternsDir, file), 'utf8'));
        } catch {
            errors.push(buildError('SUI-PATTERN-FILE', { file, reason: 'could not be read as JSON' }));
            continue;
        }
        const result = readPattern(json, file, place.kind);
        errors.push(...result.errors);
        if (result.pattern === undefined) continue;
        const problems = checkPattern(result.pattern, library, file);
        errors.push(...problems);
        if (problems.length > 0) continue;
        const { kind, summary, purposes, tree, slots, params } = result.pattern;
        read.push({ file, entry: { name: place.name, kind, summary, purposes, tree, slots, params, components: patternComponents(result.pattern, library) } });
    }

    const purposes: PatternPurposes[] = read.map(({ entry, file }) => ({ name: entry.name, file, purposes: entry.purposes }));
    const duplicates = checkPatternPurposes(purposes);
    errors.push(...duplicates);
    const repeated = new Set(duplicates.map((error) => error.file));
    const patterns = read.filter(({ file }) => !repeated.has(file)).map(({ entry }) => entry).sort(byKindThenName);
    return { patterns, errors };
}
