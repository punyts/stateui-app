import { report } from '@punyts/core';
import type { JsonSchemaDefinition } from '@punyts/core';
import type { FunctionLookup, LogicComputeFunction, LogicEffectFunction, LogicExpressionFunction, LogicSide } from '../logic/types.js';
import type { FunctionCatalog, FunctionCode, FunctionEntry, FunctionKind, FunctionPointer } from './types.js';
import { FUNCTION_KINDS } from './types.js';

const NAME = '[A-Za-z][A-Za-z0-9_]*';
/** A function's path: `$.functions.<group>.<name>` or `$.components.<component>.functions.<name>` */
export const FUNCTION_PATH = new RegExp(`^\\$\\.(?:functions\\.${NAME}\\.${NAME}|components\\.${NAME}\\.functions\\.${NAME})$`);
/** The same paths inside any text, such as an expression */
const FUNCTION_PATH_IN_TEXT = new RegExp(`\\$\\.(?:functions\\.${NAME}\\.${NAME}|components\\.${NAME}\\.functions\\.${NAME})(?![A-Za-z0-9_.])`, 'g');
/** The group the host's own functions are in */
export const HOST_GROUP = 'host';
const HOST_PREFIX = `$.functions.${HOST_GROUP}.`;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a function's path */
export function isFunctionPath(path: string): boolean {
    return FUNCTION_PATH.test(path);
}

/** Every function path named in a JSON value's strings (a document, its logic), each once, in order */
export function functionPaths(value: unknown): string[] {
    const found = new Set<string>();
    const visit = (part: unknown): void => {
        if (typeof part === 'string') {
            for (const match of part.matchAll(FUNCTION_PATH_IN_TEXT)) found.add(match[0]);
        } else if (Array.isArray(part)) {
            for (const item of part) visit(item);
        } else if (part !== null && typeof part === 'object') {
            for (const item of Object.values(part)) visit(item);
        }
    };
    visit(value);
    return [...found];
}

/** Why a catalog cannot be installed beside the others; undefined when it can */
function refusal(catalog: FunctionCatalog, entry: FunctionEntry, byId: Map<string, string>, byPath: Map<string, string>): string | undefined {
    if (!GUID.test(entry.id)) return `the function at ${entry.path} of ${catalog.name} has no GUID for its id`;
    if (!isFunctionPath(entry.path)) return `${catalog.name} has a function at ${entry.path}, which is not a function path`;
    if (!FUNCTION_KINDS.includes(entry.kind)) return `the function at ${entry.path} of ${catalog.name} has no known kind`;
    if (entry.runs.length === 0) return `the function at ${entry.path} of ${catalog.name} runs nowhere`;
    if ((catalog.name === HOST_GROUP) !== entry.path.startsWith(HOST_PREFIX)) {
        return catalog.name === HOST_GROUP ? `the host's function at ${entry.path} is not under ${HOST_PREFIX.slice(0, -1)}` : `${catalog.name} has a function at ${entry.path}, which is the host's group`;
    }
    const sameId = byId.get(entry.id.toLowerCase());
    if (sameId !== undefined) return `the function at ${entry.path} of ${catalog.name} has the GUID of ${sameId}`;
    if (byPath.has(entry.path)) return `${catalog.name} and ${byPath.get(entry.path)} both have a function at ${entry.path}`;
    return undefined;
}

/**
 * The functions one side runs, from the catalogs the operator installed: each entry by path, the pointer at its path,
 * and the code of those an app named once `prepare` loaded it. Throws when two catalogs clash (a path or a GUID twice)
 * or an entry is malformed, since that is the operator's configuration, not an app's
 */
export class FunctionTable implements FunctionLookup {
    /** The side it loads for; undefined: every entry, as the validator sees the functions of both sides */
    readonly side: LogicSide | undefined;
    readonly #entries = new Map<string, { entry: FunctionEntry; catalog: FunctionCatalog }>();
    readonly #code = new Map<string, FunctionCode>();
    readonly #loading = new Map<string, Promise<void>>();

    constructor(catalogs: readonly FunctionCatalog[], side?: LogicSide) {
        this.side = side;
        const byId = new Map<string, string>();
        const byPath = new Map<string, string>();
        for (const catalog of catalogs) {
            for (const entry of catalog.entries) {
                const refused = refusal(catalog, entry, byId, byPath);
                if (refused !== undefined) throw new Error(refused);
                byId.set(entry.id.toLowerCase(), entry.path);
                byPath.set(entry.path, catalog.name);
                if (side === undefined || entry.runs.includes(side)) this.#entries.set(entry.path, { entry, catalog });
            }
        }
    }

    /** The entries this side runs, by path */
    entries(): FunctionEntry[] {
        return [...this.#entries.values()].map((each) => each.entry).sort((a, b) => a.path.localeCompare(b.path));
    }

    entry(path: string): FunctionEntry | undefined {
        return this.#entries.get(path)?.entry;
    }

    /** The value at a function's path on this side */
    pointer(path: string): FunctionPointer | undefined {
        const found = this.#entries.get(path);
        return found === undefined ? undefined : { fn: found.entry.id };
    }

    has(path: string, kind: FunctionKind): boolean {
        return this.#entries.get(path)?.entry.kind === kind;
    }

    /**
     * Loads the code of the named functions this side runs and has not loaded. Returns undefined when it is all here
     * already (every loader answered at once), else a promise that settles when every load has: a load that fails is
     * reported, and calling that function fails as an unknown one does
     */
    prepare(paths: Iterable<string>): Promise<void> | undefined {
        const waiting: Promise<void>[] = [];
        for (const path of paths) {
            const found = this.#entries.get(path);
            if (found === undefined || this.#code.has(found.entry.id)) continue;
            const pending = this.#loading.get(found.entry.id);
            if (pending !== undefined) {
                waiting.push(pending);
                continue;
            }
            const { entry, catalog } = found;
            const failed = (error: unknown): void => report.warning('A function could not be loaded', { path: entry.path, catalog: catalog.name, reason: String(error) });
            let loaded: FunctionCode | Promise<FunctionCode>;
            try {
                loaded = catalog.load(entry.id);
            } catch (error) {
                failed(error);
                continue;
            }
            if (typeof loaded === 'function') {
                this.#code.set(entry.id, loaded);
                continue;
            }
            const load = Promise.resolve(loaded).then(
                (code) => {
                    if (typeof code === 'function') this.#code.set(entry.id, code);
                    else failed('the loader gave no function');
                },
                failed
            ).finally(() => this.#loading.delete(entry.id));
            this.#loading.set(entry.id, load);
            waiting.push(load);
        }
        return waiting.length === 0 ? undefined : Promise.all(waiting).then(() => undefined);
    }

    #loaded(path: string, kind: FunctionKind): FunctionCode | undefined {
        const found = this.#entries.get(path);
        return found?.entry.kind === kind ? this.#code.get(found.entry.id) : undefined;
    }

    compute(path: string): LogicComputeFunction | undefined {
        return this.#loaded(path, 'compute') as LogicComputeFunction | undefined;
    }

    expression(path: string): LogicExpressionFunction | undefined {
        return this.#loaded(path, 'expression') as LogicExpressionFunction | undefined;
    }

    effect(path: string): LogicEffectFunction | undefined {
        return this.#loaded(path, 'effect') as LogicEffectFunction | undefined;
    }
}

/** A function with its code at hand, for a catalog whose code is already loaded (the host's own, a test's) */
export type LoadedFunction = FunctionEntry & { code: FunctionCode };

/** A catalog of functions whose code is already loaded: its loader answers at once */
export function catalogOf(name: string, functions: readonly LoadedFunction[]): FunctionCatalog {
    const code = new Map(functions.map((each) => [each.id.toLowerCase(), each.code]));
    return {
        name,
        entries: functions.map(({ code: _code, ...entry }) => entry),
        load(id) {
            const found = code.get(id.toLowerCase());
            if (found === undefined) throw new Error(`${name} has no function with the GUID ${id}`);
            return found;
        }
    };
}

/** One of the host's own functions, as the host writes it: the path is `$.functions.host.<name>` */
export interface HostFunction {
    /** The GUID the host gives it, kept for the function's life */
    id: string;
    kind: FunctionKind;
    code: FunctionCode;
    /** One line on what it does, for the agent and Statenet */
    summary: string;
    /** Where it may run; both sides when absent */
    runs?: readonly LogicSide[];
    /** Its inputs or arguments; any value when absent */
    inputs?: JsonSchemaDefinition;
    /** Its outputs or result; any value when absent */
    outputs?: JsonSchemaDefinition;
}

/** The host's catalog, from its functions by name: each at `$.functions.host.<name>` */
export function hostCatalog(functions: Readonly<Record<string, HostFunction>>): FunctionCatalog {
    return catalogOf(HOST_GROUP, Object.entries(functions).map(([name, each]) => ({
        id: each.id,
        path: `${HOST_PREFIX}${name}`,
        kind: each.kind,
        runs: each.runs ?? ['server', 'browser'],
        summary: each.summary,
        inputs: each.inputs ?? {},
        outputs: each.outputs ?? {},
        code: each.code
    })));
}
