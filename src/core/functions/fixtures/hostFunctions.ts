import type { LogicSide } from '../../logic/types.js';
import { FunctionTable, catalogOf } from '../table.js';
import type { FunctionCode, FunctionKind } from '../types.js';

/** A table of host functions for tests: each path's kind and code, under a fresh GUID, loaded and run on both sides */
export function hostFunctions(functions: Record<string, [FunctionKind, FunctionCode]>, side: LogicSide = 'server'): FunctionTable {
    const loaded = Object.entries(functions).map(([path, [kind, code]]) => ({ id: crypto.randomUUID(), path, kind, runs: ['server', 'browser'] as const, summary: path, inputs: {}, outputs: {}, code }));
    const table = new FunctionTable([catalogOf('host', loaded)], side);
    void table.prepare(Object.keys(functions));
    return table;
}
