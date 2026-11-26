import type { RouteScreens } from '../route/index.js';
import type { FunctionEntry } from '../functions/types.js';
import type { JsonValue } from '../types.js';

/** The origin a browser store write of the logic carries, so the logic capture skips it and sync sends it */
export const LOGIC_ORIGIN = 'logic';

/** The longest delay of an `after` or `debounce` trigger: 24 hours */
export const MAX_DELAY = 24 * 60 * 60 * 1000;

/** The longest chain: writes of a transition that trigger more transitions, at most this many levels deep */
export const MAX_CHAIN_DEPTH = 8;

/** The app event raised when a transition fails or a guard refuses a change in the browser */
export const LOGIC_FAILED_EVENT = 'logic.failed';

/** `notify` raises the app event `notify.<name>` in the open views */
export const NOTIFY_PREFIX = 'notify.';

/** The built-in commands, the only way logic changes anything */
export const LOGIC_COMMANDS = [
    'set',
    'merge',
    'copy',
    'toggle',
    'increment',
    'reset',
    'save-data',
    'delete-data',
    'pull-data',
    'query',
    'notify',
    'emit',
    'call',
    'reject',
    'navigate'
] as const;

export type LogicCommandName = (typeof LOGIC_COMMANDS)[number];

/** The keys a logic command object may carry */
export const LOGIC_COMMAND_KEYS = [
    'command',
    'target',
    'value',
    'from',
    'into',
    'key',
    'as',
    'sort',
    'filter',
    'window',
    'reason',
    'await'
] as const;

/** What starts a transition: a change at a path, or a named result of an earlier command (of the same machine, or of a rule) */
export interface LogicTrigger {
    /** A state path with `*` (one segment) and `{name}` (one segment, captured) steps */
    path?: string;
    /** The `as` name of a `save-data` or `delete-data` command: of the same machine for a transition, of a rule for a rule */
    result?: string;
    /** The value at the path, or the result status (`accepted`, `rejected`), must equal this, or one of its items when it is a list */
    is?: JsonValue;
    /** The value at the path before the change (`$previous`) must equal this, or one of its items when it is a list */
    was?: JsonValue;
    /** Milliseconds a machine stays in `from` before the transition fires; no `path` or `result` with it */
    after?: number;
    /** Milliseconds without another matching change before a `path` trigger fires */
    debounce?: number;
    /** An expression that must be true */
    if?: string;
}

export interface LogicCommand {
    command: LogicCommandName;
    target?: string;
    value?: JsonValue;
    from?: string;
    into?: string;
    key?: string;
    as?: string;
    sort?: JsonValue;
    filter?: string;
    window?: JsonValue;
    reason?: string;
    /**
     * When a `save-data` or `delete-data` with `as` gives its accepted result. `durable`, the default: once its write is
     * durable, on a host that says so (in the database, on a server), so a form shows Saved only when it is; at once on
     * a host that keeps nothing. `applied`: at once, as soon as the write is in the state. A rejection comes at once
     */
    await?: 'durable' | 'applied';
}

export interface LogicTransition {
    /** The state the machine must be in; absent matches any state */
    from?: string;
    when: LogicTrigger;
    do?: LogicCommand[];
    /** The state the machine moves to; absent keeps it */
    to?: string;
}

/**
 * Where a unit runs in a Full-mode app: `server` (the default) on the app server's authority, `browser` in the
 * person's page on their own changes. Outside Full mode every unit runs in the browser and `runs` is ignored
 */
export type LogicSide = 'server' | 'browser';

/** The sides a unit may name in `runs` */
export const LOGIC_SIDES: readonly LogicSide[] = ['server', 'browser'];

export interface LogicMachine {
    /** The state path that holds the machine's current state */
    state: string;
    /** The state written when the path has no value */
    initial: string;
    transitions: LogicTransition[];
    /** Where it runs in a Full-mode app; absent is `server` */
    runs?: LogicSide;
}

/** A machine with one state: when the trigger matches, run the commands */
export interface LogicRule {
    when: LogicTrigger;
    do: LogicCommand[];
    /** Where it runs in a Full-mode app; absent is `server` */
    runs?: LogicSide;
}

/**
 * An input of a lookup table: a state value read when the table runs. With `values` or `breaks` it is a key input, one
 * dimension of the table's cells, which rows match on; without them it is a plain input, which only the outputs read
 */
export interface LogicTableInput {
    /** A state path or node reference; `{name}` steps capture, so the table runs per record */
    path?: string;
    /** A `{{ … }}` expression instead of a path; it runs when a state path it reads changes */
    value?: string;
    /** The values it takes, `"*"` for any other; or `{ keys }`, the keys of a data map */
    values?: JsonValue[] | { keys: string };
    /** Ascending numbers that split it into buckets: `[50, 100]` is below 50, 50 up to 100, and 100 and above */
    breaks?: number[];
}

/** A row of a lookup table: key input names to conditions, and output names to values */
export type LogicTableRow = Record<string, JsonValue>;

/**
 * A lookup table: inputs (a path alone is a plain input), outputs (names to the state paths they write) and rows, or
 * `{ from }`, a data map whose records are the rows. A change to an input path runs it; the first row whose conditions
 * hold for every key input wins, and its outputs are written. Its rows are compiled into a lookup by key input
 */
export interface LogicTable {
    inputs: Record<string, LogicTableInput | string>;
    outputs: Record<string, string>;
    rows: LogicTableRow[] | { from: string };
    /** Where it runs in a Full-mode app; absent is `server` */
    runs?: LogicSide;
}

/** An input of a compute unit: a state path or node reference (`{name}` steps capture), or one `{{ … }}` expression */
export type LogicComputeInput = Pick<LogicTableInput, 'path' | 'value'>;

/**
 * A compute unit: a compute function (`FunctionLookup.compute`), run like a table. A change to an input runs
 * it (per record when its input paths capture); it gets the input values by name and returns the output values by name,
 * and the outputs that differ from state are written
 */
export interface LogicCompute {
    inputs: Record<string, LogicComputeInput | string>;
    /** The function's path: `$.functions.<group>.<name>` or `$.components.<component>.functions.<name>` */
    run: string;
    outputs: Record<string, string>;
    /** Where it runs in a Full-mode app; absent is `server` */
    runs?: LogicSide;
}

/** A compute function: the input values by name (absent for an input with no value) to output values by name */
export type LogicComputeFunction = (inputs: Readonly<Record<string, JsonValue>>) => Readonly<Record<string, JsonValue>>;

/** A function expressions call by its path, next to the built-in ones (`LOGIC_FUNCTIONS`) by name */
export type LogicExpressionFunction = (...args: JsonValue[]) => JsonValue;

/** The most answers an effect keeps in its token cache */
export const MAX_EFFECT_CACHE = 200;

/**
 * An effect: async work that turns a request in state into a result in state. Writing a value at `request` starts
 * it; the request's canonical hash is its token, so equal requests share a token. `status` gets
 * `LogicEffectStatus`; the answer's records merge into `records.into` by their `records.key` field, and fill the record
 * view at `window` by position. Paths are state paths or node references
 */
export interface LogicEffect {
    request: string;
    /** The function's path: `$.functions.<group>.<name>` or `$.components.<component>.functions.<name>` */
    run: string;
    status: string;
    /** The data map the answer's records merge into, and the field that holds each record's primary key */
    records?: { into: string; key: string };
    /** The record view whose records (by position from the answer's `first`) and `total` the answer writes */
    window?: string;
    /** Where the answer's `value` is written */
    value?: string;
    /** How many answers to keep in memory, by token; a request with a kept token refills the window with no call */
    cache?: number;
    /** Where it runs in a Full-mode app; absent is `server` */
    runs?: LogicSide;
}

/** What an effect function answers: records from `first` in the server's order, the total, or a value */
export interface LogicEffectAnswer {
    first?: number;
    records?: JsonValue[];
    total?: number;
    value?: JsonValue;
}

/** An effect function: gets a copy of the request and a signal that aborts when a newer request replaces it */
export type LogicEffectFunction = (request: JsonValue, options: { signal: AbortSignal }) => Promise<LogicEffectAnswer>;

/** An effect request the host answers when no function is installed at its `run` path (the MCP agent) */
export interface LogicEffectRequest {
    /** The effect's name in the document */
    name: string;
    run: string;
    token: string;
    request: JsonValue;
}

/** What an effect writes at its `status` path */
export interface LogicEffectStatus {
    /** The token of the request it is about; absent when idle with no request */
    token?: string;
    state: 'idle' | 'loading' | 'ready' | 'error';
    total?: number;
    reason?: string;
    /** ISO time */
    at: string;
}

/** An effect as `LogicEngine.effects` reports it */
export interface LogicEffectInfo {
    name: string;
    /** The token of the request it last acted on */
    token?: string;
    /** True while a call is running */
    running: boolean;
    /** How many answers its cache holds */
    cached: number;
}

/**
 * The functions logic runs, by path: documents never hold code, they name a function's path. A `FunctionTable` built
 * from the installed catalogs is one; it answers only for code it has loaded
 */
export interface FunctionLookup {
    /** True when this side runs a function of this kind at the path, loaded or not */
    has(path: string, kind: 'compute' | 'expression' | 'effect'): boolean;
    /** A synchronous, side-effect-free function that a `computes` unit runs */
    compute(path: string): LogicComputeFunction | undefined;
    /** A function expressions call */
    expression(path: string): LogicExpressionFunction | undefined;
    /** An async function that an effect runs */
    effect(path: string): LogicEffectFunction | undefined;
    /** The manifest entry at the path, whose schemas a unit that runs it must fit */
    entry?(path: string): FunctionEntry | undefined;
}

/** The `logic` root of a document */
export interface LogicDocument {
    machines?: Record<string, LogicMachine>;
    rules?: Record<string, LogicRule>;
    tables?: Record<string, LogicTable>;
    computes?: Record<string, LogicCompute>;
    effects?: Record<string, LogicEffect>;
}

/** A change the engine looks up: a value written at a path, or a delete when `value` is absent */
export interface LogicChange {
    path: string;
    value?: JsonValue;
    /** The value at the path before the change, for `$previous`; absent when there was none */
    previous?: JsonValue;
    /**
     * Written from outside the logic (a person's change, a tool's write): it fires the units whose trigger is its own
     * path even when it set the value the path already held, as a press that sets `clicked` to true does every time.
     * The logic's own writes are never explicit, so a unit that writes the value its trigger holds does not run again
     */
    explicit?: boolean;
}

/** A write of a transition; a delete when `value` is absent */
export interface LogicWrite {
    path: string;
    value?: JsonValue;
}

/** What a failure, a trace event or a refusal names: a machine, a rule, a table, a guard rule, or a chain of them */
export type LogicUnitKind = 'machine' | 'rule' | 'table' | 'compute' | 'effect' | 'guard' | 'chain';

/** A transition that failed or a change a guard refused, for `logic.failed` and the reporter */
export interface LogicFailure {
    kind: LogicUnitKind;
    /** The machine, rule, table, compute or guard name; for a chain, the names that fired in it */
    name: string;
    /** The machine's state when the transition fired */
    from?: string;
    /** The index of the failing command */
    command?: number;
    reason: string;
}

/** The answer to a `call`: `accepted` with a value, or `rejected` with a reason */
export interface LogicAnswer {
    status: 'accepted' | 'rejected';
    value?: JsonValue;
    reason?: string;
}

/** What a `save-data` or `delete-data` command gives to the transitions that wait for it (`$result`) */
export interface LogicResult {
    status: 'accepted' | 'rejected';
    reason?: string;
    /** The key of the saved or deleted record */
    key?: string;
    /** The value a `call` was answered with */
    value?: JsonValue;
}

/**
 * What the engine needs from where it runs: a browser store or an app server's authority. Paths are absolute state
 * paths (`$.data.contacts`); node references are resolved by `resolve`
 */
export interface LogicHost {
    /**
     * Resolves once every write committed so far is durable; a command with `await: 'durable'` gives its result then.
     * Without it, such a result comes at once
     */
    durable?(): Promise<void>;
    /** The value at a path; the engine never changes what it returns */
    get(path: string): JsonValue | undefined;
    /** Applies the writes of one transition, all or none; throws when they cannot be applied */
    commit(writes: readonly LogicWrite[]): void;
    /** A node reference (`#addContact.body.saved`) as a state path; undefined when it does not resolve */
    resolve?(reference: string): string | undefined;
    /** The document's value at a path, shape defaults included, which `reset` writes back */
    initial?(path: string): JsonValue | undefined;
    /** The fields of the form at a path: child key to the state path of the field's value */
    fields?(path: string): Record<string, string> | undefined;
    /** The property the record view at a path takes its records in; `query` writes `records` when it is unknown */
    records?(path: string): string | undefined;
    /** Raises `notify.<name>` in the open views */
    notify?(name: string, payload: JsonValue): void;
    /** Sends an app event to the server */
    emit?(name: string, payload: JsonValue): void;
    /** A failed transition or a refused change */
    failed?(failure: LogicFailure): void;
    /** A new record key; it must not be integer-like */
    newKey?(): string;
    /** Runs `run` after `ms` milliseconds; returns the function that cancels it. Without it timers never fire */
    schedule?(ms: number, run: () => void): () => void;
    /** The document's screens, which `navigate` moves `$.route` between; without it every `navigate` fails */
    screens?(): RouteScreens | undefined;
    /** The functions this side runs; without them a compute unit or a function call fails when it runs */
    functions?: FunctionLookup;
    /**
     * Answers an effect whose `run` is a function this side does not run (the MCP server queues it for the agent);
     * without it such an effect fails. `signal` aborts when a newer request replaces it
     */
    effect?(request: LogicEffectRequest, signal: AbortSignal): Promise<LogicEffectAnswer>;
    /** Runs a named server procedure (Full mode); without it every `call` is rejected */
    call?(name: string, payload: JsonValue): Promise<LogicAnswer>;
    /**
     * The host's own refusal of a proposed change, asked after the guard rules (the server checks shared dataset
     * records against their model); `save-data` and `delete-data` give its reason as their `rejected` result
     */
    guard?(change: LogicChange): string | undefined;
}

/** Why a unit whose trigger path matched a change did not fire, or that it fired */
export type LogicTraceOutcome =
    /** Its commands ran and committed */
    | 'fired'
    /** It started its debounce timer */
    | 'debounced'
    /** A command or the commit failed; nothing was written */
    | 'failed'
    /** It already fired in this chain (a unit fires at most once per chain) */
    | 'already-fired'
    /** The value at its path is the value it had before the change */
    | 'unchanged'
    /** Its path went away with a parent (a record was removed); trigger on the record path to see removals */
    | 'parent-removed'
    /** The machine is not in the transition's `from` state */
    | 'other-state'
    /** `is`, `was` or `if` was false, or no table row matched */
    | 'condition'
    /** A guard refused the change */
    | 'refused';

/** One unit the trace looked at in one step of a chain */
export interface LogicTraceEvent {
    /** The chain step: 0 for the changes that started it */
    depth: number;
    kind: LogicUnitKind;
    name: string;
    outcome: LogicTraceOutcome;
    /** The concrete path that matched */
    path?: string;
    /** The machine's state, and the state it moved to */
    from?: string;
    to?: string;
    /** The index of the table row that ran */
    row?: number;
    /** The paths a fired unit wrote */
    writes?: string[];
    reason?: string;
}

/** One run of the engine: what started it and what every matching unit did */
export interface LogicTraceRun {
    /** ISO time */
    at: string;
    cause: 'change' | 'result' | 'timer' | 'answer' | 'start' | 'guard' | 'effect';
    /** The paths of the changes (or the result name) that started it */
    changes: string[];
    events: LogicTraceEvent[];
}
