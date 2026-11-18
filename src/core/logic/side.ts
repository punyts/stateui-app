import type { LogicDocument, LogicSide } from './types.js';

const GROUPS = ['machines', 'rules', 'tables', 'computes', 'effects'] as const;

/**
 * The units of a logic document that run on one side of a Full-mode app: `server` takes the units without `runs` and
 * those with `runs: "server"`, `browser` those with `runs: "browser"`. Groups left with no unit are absent, so the
 * result of a side with no units is `{}`
 */
export function logicFor(logic: LogicDocument, side: LogicSide): LogicDocument {
    const kept: LogicDocument = {};
    for (const group of GROUPS) {
        const entries = Object.entries(logic[group] ?? {}).filter(([, unit]) => (unit.runs ?? 'server') === side);
        if (entries.length > 0) (kept as Record<string, unknown>)[group] = Object.fromEntries(entries);
    }
    return kept;
}

