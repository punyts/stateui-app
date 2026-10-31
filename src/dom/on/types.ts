import type { Store } from '@punyts/state';
import type { BuildError } from '../../core/errors/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import type { JsonValue } from '../../core/types.js';
import type { TransferFile } from '../../runtime/fileTransfer.js';

/**
 * What a root component's `commands` object holds for one command: `value` is the command object's `value`
 * (absent when it has none; `$row` and `$row.path` are already read from the record), `payload` is the `detail`
 * of the event that started the list, and `row` is the store path of the record when the command was aimed at
 * `$row` from a row template. It throws to fail,
 * which stops the rest of the list; it is synchronous
 */
export type CommandHandler = (value: JsonValue | undefined, payload: unknown, row?: string) => void;

/**
 * The command interface of a root component: the element carries a `commands` object with one function per command
 * its shape declares in `commands`. A controller sets it when it runs and removes it in `dispose`
 */
export interface CommandElement extends Element {
    commands?: Readonly<Record<string, CommandHandler>>;
}

/** What the host application hands to the dispatcher */
export interface DispatchHooks {
    /** Called by the system command `emit` with the event name (the command's `target`) and its payload */
    onEmit?(name: string, payload: unknown): void;
    /**
     * Hands a file to the host and resolves with the reference of the stored file (E8.39). Set by the runtime inside
     * the preview frame; absent when the app is mounted without a host that takes files
     */
    transferFile?: TransferFile;
    /** Called with every `SUI-RUN` error the dispatcher reports, after it is reported through `@punyts/core` */
    onError?(error: BuildError): void;
}

export interface DispatcherOptions {
    /** The element the store is mounted on; the dispatcher listens here for events raised by the nodes below it */
    host: Element;
    store: Store<unknown>;
    library: ComponentLibrary;
    /** `ResolveResult.instances`: where composed components were expanded, for `^name` targets; empty when absent */
    instances?: Readonly<Record<string, string[]>>;
    /** The state path of the root node; `$.app` when absent */
    rootPath?: string;
    hooks?: DispatchHooks;
}

export interface Dispatcher {
    /** Removes every listener; later events do nothing. Safe to call more than once */
    dispose(): void;
}
