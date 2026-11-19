import type { JsonSchemaDefinition } from '@punyts/core';
import type { LogicComputeFunction, LogicEffectFunction, LogicExpressionFunction, LogicSide } from '../logic/types.js';

/** What a function is to logic: a compute unit's `run`, an expression call, or an effect's `run` */
export type FunctionKind = 'compute' | 'expression' | 'effect';

export const FUNCTION_KINDS: readonly FunctionKind[] = ['compute', 'expression', 'effect'];

/**
 * A function's manifest entry: what a document, the validator, the agent and Statenet know of it without its code.
 * Its author gives it its GUID and keeps it for the function's life; the path is where documents name it
 */
export interface FunctionEntry {
    /** The GUID the runtime loads the code by; the pointer at `path` holds it */
    id: string;
    /** `$.functions.<group>.<name>`, or `$.components.<component>.functions.<name>` for a component's function */
    path: string;
    kind: FunctionKind;
    /** Where it may run */
    runs: readonly LogicSide[];
    /** One line on what it does, for the agent and Statenet */
    summary: string;
    /** A compute's inputs (an object schema), an expression's arguments (an array schema) or an effect's request */
    inputs: JsonSchemaDefinition;
    /** A compute's outputs (an object schema), an expression's result or an effect's answer */
    outputs: JsonSchemaDefinition;
}

/** The code behind an entry, of its kind */
export type FunctionCode = LogicComputeFunction | LogicExpressionFunction | LogicEffectFunction;

/**
 * Functions a library or the host supplies: the entries, always present, and a loader for the code, which the runtime
 * calls only for the functions an app names. A loader may return a promise (a lazy chunk)
 */
export interface FunctionCatalog {
    /** Who supplies it, for messages: a library's name, or `host` */
    name: string;
    entries: readonly FunctionEntry[];
    /** The code of the function with this GUID */
    load(id: string): FunctionCode | Promise<FunctionCode>;
}

/** The value at a function's path: a pointer to its code, never the code */
export interface FunctionPointer {
    fn: string;
}
