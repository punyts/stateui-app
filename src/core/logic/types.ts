import type { JsonValue } from '../types.js';

/** The origin a browser store write of the logic carries, so the logic capture skips it and sync sends it */
export const LOGIC_ORIGIN = 'logic';

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
    'reject'
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
    'reason'
] as const;

/** What starts a transition: a change at a path, or a named result of an earlier command of the same machine */
export interface LogicTrigger {
    /** A state path with `*` (one segment) and `{name}` (one segment, captured) steps */
    path?: string;
    /** The `as` name of a `save-data` or `delete-data` command of the same machine */
    result?: string;
    /** The value at the path, or the result status (`accepted`, `rejected`), must equal this */
    is?: JsonValue;
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
}

export interface LogicTransition {
    /** The state the machine must be in; absent matches any state */
    from?: string;
    when: LogicTrigger;
    do?: LogicCommand[];
    /** The state the machine moves to; absent keeps it */
    to?: string;
}

export interface LogicMachine {
    /** The state path that holds the machine's current state */
    state: string;
    /** The state written when the path has no value */
    initial: string;
    transitions: LogicTransition[];
}

/** A machine with one state: when the trigger matches, run the commands */
export interface LogicRule {
    when: LogicTrigger;
    do: LogicCommand[];
}

/** The `logic` root of a document */
export interface LogicDocument {
    machines?: Record<string, LogicMachine>;
    rules?: Record<string, LogicRule>;
}

/** A change the engine looks up: a value written at a path, or a delete when `value` is absent */
export interface LogicChange {
    path: string;
    value?: JsonValue;
}

/** A write of a transition; a delete when `value` is absent */
export type LogicWrite = LogicChange;

/** A transition that failed or a change a guard refused, for `logic.failed` and the reporter */
export interface LogicFailure {
    /** The machine or rule name */
    machine: string;
    /** The machine's state when the transition fired */
    from?: string;
    /** The index of the failing command */
    command?: number;
    reason: string;
}

/** What a `save-data` or `delete-data` command gives to the transitions that wait for it (`$result`) */
export interface LogicResult {
    status: 'accepted' | 'rejected';
    reason?: string;
    /** The key of the saved or deleted record */
    key?: string;
}

/**
 * What the engine needs from where it runs: a browser store or an app server's authority. Paths are absolute state
 * paths (`$.data.contacts`); node references are resolved by `resolve`
 */
export interface LogicHost {
    /** The value at a path; the engine never changes what it returns */
    get(path: string): JsonValue | undefined;
    /** Applies the writes of one transition, all or none; throws when they cannot be applied */
    commit(writes: readonly LogicWrite[]): void;
    /** A node reference (`^addContact.body.saved`) as a state path; undefined when it does not resolve */
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
}
