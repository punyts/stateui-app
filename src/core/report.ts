/**
 * The categories stateui-app reports under (`stateui-app.*` turns them all on) and the clock for their durations. DOM-
 * and Node-free: reports go through `@punyts/core`'s `report`, and `performance.now()` is in both browsers and Node
 */
export const REPORT = {
    validate: 'stateui-app.validate',
    assemble: 'stateui-app.assemble',
    mount: 'stateui-app.mount',
    command: 'stateui-app.command',
    machine: 'stateui-app.logic.machine',
    rule: 'stateui-app.logic.rule',
    compute: 'stateui-app.logic.compute',
    effect: 'stateui-app.logic.effect',
    table: 'stateui-app.logic.table',
    build: 'stateui-app.build'
} as const;

/** The time now in milliseconds, for a duration */
export function reportClock(): number {
    return performance.now();
}

/** The milliseconds since `start`, rounded to a tenth */
export function elapsed(start: number): number {
    return Math.round((performance.now() - start) * 10) / 10;
}
