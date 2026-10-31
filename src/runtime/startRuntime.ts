import { report } from '@punyts/core';
import { buildError } from '../core/errors/index.js';
import type { BuildError } from '../core/errors/index.js';
import type { ComponentLibrary } from '../core/resolve/index.js';
import type { ComponentOverlays } from '../core/locale/index.js';
import { snapshotState } from '../core/snapshot/index.js';
import { buildOverlayCatalog } from '../core/theme/index.js';
import type { ThemeOverlays } from '../core/theme/index.js';
import { PREFIXES } from '../core/types.js';
import type { JsonValue } from '../core/types.js';
import { registerLocaleStep } from '../dom/locale/index.js';
import { mountApp, registerMountStep } from '../dom/mount/index.js';
import type { MountedApp } from '../dom/mount/index.js';
import type { CommandContext } from '../dom/on/commands.js';
import { applyOverlay } from '../dom/theme/index.js';
import type { ThemeStore } from '../dom/theme/index.js';
import { createFileTransfers } from './fileTransfer.js';
import { MAX_ERROR_TEXT, MAX_ERRORS } from './limits.js';
import { INBOUND_TYPES, PROTOCOL_VERSION } from './messages.js';
import type {
    CommandMessage,
    FileProgressMessage,
    FileResultMessage,
    IconsMap,
    InboundMessage,
    LoadMessage,
    LocaleMessage,
    OutboundMessage,
    PathWrite,
    ProtocolError,
    StateSnapshotData,
    ThemeMessage,
    WriteMessage
} from './messages.js';
import { runCommandMessage } from './runCommandMessage.js';
import { validateMessage } from './validate.js';

const STEP_NAME = 'runtime-load';
const ICONS_PATH = '$.runtime.icons';
const WATCHED = ['$.data', '$.data.$all', '$.app', '$.app.$all'];
const DATA_ROOT = '$.data';
/** The runtime posts at most this many errors in its life, so a failing app cannot flood the host */
const MAX_POSTED_ERRORS = 200;

/** Where the runtime posts: `window.parent` in the iframe, a fake in tests */
export interface MessageTarget {
    postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
}

/** What `startRuntime` needs from the window: the `message` and error events */
export type RuntimeWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'document'>;

export interface RuntimeOptions {
    /** The element the application is mounted on; `window.document.body` when absent */
    host?: Element;
    /** The locale overlays of the library's components (`<name>.locale.<code>.json`), used by the `locale` message; none when absent */
    componentOverlays?: ComponentOverlays;
}

/** How many messages the runtime dropped, by reason */
export interface DroppedCounts {
    /** Not an object of the protocol, or a field of its type is wrong */
    invalid: number;
    /** A `type` outside the closed set */
    unknown: number;
    /** Over the byte limit of its type, or not serialisable */
    oversized: number;
    /** Valid, but not handled: a type only the runtime sends, or `command`, `locale` or `theme` while no application is mounted */
    unhandled: number;
    /** From another source or with another nonce */
    foreign: number;
}

export interface RuntimeStats {
    dropped: DroppedCounts;
}

export interface RuntimeHandle {
    /** A copy of the counters */
    stats(): RuntimeStats;
    /** Removes the listeners and the mounted application. Safe to call more than once */
    dispose(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toJson(value: unknown): JsonValue | undefined {
    try {
        const text = JSON.stringify(value);
        return text === undefined ? undefined : (JSON.parse(text) as JsonValue);
    } catch {
        return undefined;
    }
}

function truncate(text: string): string {
    return text.length > MAX_ERROR_TEXT ? text.slice(0, MAX_ERROR_TEXT) : text;
}

function protocolError(error: BuildError): ProtocolError {
    const result: ProtocolError = { code: error.code, message: truncate(error.message) };
    if (error.severity) result.severity = error.severity;
    if (error.statePath !== undefined) result.statePath = truncate(error.statePath);
    if (error.component !== undefined) result.component = truncate(error.component);
    return result;
}

/**
 * The state paths of data that a password field is bound to: a node with `inputType: "password"` and a
 * `<-value` link to `$.data...`, found anywhere in the document (the app and every composed tree)
 */
function passwordDataPaths(value: unknown, found: Set<string> = new Set()): Set<string> {
    if (Array.isArray(value)) {
        for (const item of value) passwordDataPaths(item, found);
    } else if (isRecord(value)) {
        const target = value[`${PREFIXES.link}value`];
        if (value['inputType'] === 'password' && typeof target === 'string' && (target === DATA_ROOT || target.startsWith(`${DATA_ROOT}.`))) {
            found.add(target);
        }
        for (const item of Object.values(value)) passwordDataPaths(item, found);
    }
    return found;
}

/** Writes the articulation values of a snapshot where the node still exists; a value for a vanished node is skipped */
function applyArticulation(store: { get(path: string): unknown; set(path: string, value: never): boolean }, path: string, value: unknown): void {
    if (isRecord(value)) {
        for (const [key, item] of Object.entries(value)) {
            const child = `${path}.${key}`;
            if (store.get(child) !== undefined) applyArticulation(store, child, item);
        }
    } else if (value !== undefined) {
        store.set(path, value as never);
    }
}

/**
 * Starts the runtime inside the iframe. It listens on `win` for `message` events and acts on a message only when
 * `event.source === parent` (pass `window.parent`), it passes `validateMessage` and its `nonce` is `nonce`; anything
 * else is dropped and counted (`stats()`).
 *
 * - `load` mounts the application with `mountApp` (a running one is disposed first), puts the state snapshot over it
 *   and writes the `icons` map to `$.runtime.icons` before the first render, then posts `ready`. A document that does
 *   not mount posts `error` with the errors and no `ready`.
 * - `write` sets or removes the paths below `$.data` and `$.app` (a changed `component` re-renders only that node
 *   through `<sui-node>`), merges its `icons` into `$.runtime.icons`, and posts `snapshot`.
 * - `ping` is answered with `pong`.
 * - `command` runs a component command with the runner the dispatcher uses for `on` (`target` is a `$.app` node path;
 *   the system commands `set`, `toggle` and `emit` are refused). `locale` applies a language overlay (`switchLocale`,
 *   from the document's `locales` and `options.componentOverlays`) and leaves `$.data` alone. `theme` applies the
 *   overlay `name` of `kind` (`applyOverlay`: the shipped overlays and the document's `themes`). A failure posts
 *   `error` and changes nothing. With no application mounted these three are counted as `unhandled`.
 *
 * It posts `snapshot` (also when the user changes `$.data` or articulation, only when it differs from the last one),
 * `emit` from the dispatcher hook and `error` for validation and runtime errors. A snapshot is built with
 * `snapshotState` and leaves out links, `$.runtime`, content, runtime articulation and the value of `inputType:
 * "password"` fields (and the data such a field is linked to). The host throttles snapshots.
 *
 * Posting uses the target origin `*`: a frame sandboxed without `allow-same-origin` has an opaque origin, and the
 * nonce is what the host checks
 */
export function startRuntime(
    win: RuntimeWindow,
    parent: MessageTarget,
    nonce: string,
    library: ComponentLibrary,
    options: RuntimeOptions = {}
): RuntimeHandle {
    const dropped: DroppedCounts = { invalid: 0, unknown: 0, oversized: 0, unhandled: 0, foreign: 0 };
    let mounted: MountedApp | undefined;
    let watching: { store: NonNullable<MountedApp['store']>; listener: () => void } | undefined;
    const localeStep = registerLocaleStep(options.componentOverlays ?? {});
    let themeOverlays: ThemeOverlays = buildOverlayCatalog(undefined).overlays;
    let passwordData = new Set<string>();
    let lastSnapshot = '';
    let scheduled = false;
    let postedErrors = 0;
    let disposed = false;

    function post(message: { type: OutboundMessage['type'] } & Record<string, unknown>, transfer?: Transferable[]): boolean {
        const full = { v: PROTOCOL_VERSION, nonce, ...message };
        const result = validateMessage(full);
        if (!result.ok) {
            dropped[result.reason] += 1;
            return false;
        }
        if (transfer) parent.postMessage(full, '*', transfer);
        else parent.postMessage(full, '*');
        return true;
    }

    const files = createFileTransfers({
        sendFile: (message) => post({ type: 'file', ...message }, [message.data]),
        sendCancel: (requestId) => {
            post({ type: 'fileCancel', requestId });
        }
    });

    function postErrors(errors: readonly BuildError[]): void {
        const room = MAX_POSTED_ERRORS - postedErrors;
        const list = errors.slice(0, Math.min(MAX_ERRORS, Math.max(room, 0))).map(protocolError);
        if (list.length === 0) return;
        postedErrors += list.length;
        post({ type: 'error', errors: list });
    }

    function snapshot(): StateSnapshotData | undefined {
        const store = mounted?.store;
        if (!store) return undefined;
        return snapshotState(store, {
            exclude: (path) => {
                if (passwordData.has(path)) return true;
                if (!path.startsWith('$.app.') || !path.endsWith('.value')) return false;
                const owner: unknown = store.get(path.slice(0, path.lastIndexOf('.')));
                return isRecord(owner) && owner['inputType'] === 'password';
            }
        });
    }

    function postSnapshot(): void {
        const current = snapshot();
        if (!current) return;
        lastSnapshot = JSON.stringify(current);
        post({ type: 'snapshot', ...current });
    }

    /** Store-driven changes (typing, controllers) post a snapshot once per tick, and only when it changed */
    function scheduleSnapshot(): void {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            if (disposed) return;
            const current = snapshot();
            if (current && JSON.stringify(current) !== lastSnapshot) postSnapshot();
        });
    }

    function unwatch(): void {
        if (watching) watching.store.off(WATCHED, watching.listener);
        watching = undefined;
    }

    function teardown(): void {
        files.cancelAll();
        unwatch();
        mounted?.dispose();
        mounted = undefined;
    }

    function writeIcons(store: NonNullable<MountedApp['store']>, icons: IconsMap): void {
        for (const [name, icon] of Object.entries(icons)) store.set(`${ICONS_PATH}.${name}`, icon as never);
    }

    function load(message: LoadMessage): void {
        teardown();
        lastSnapshot = '';
        passwordData = passwordDataPaths(message.document);
        themeOverlays = buildOverlayCatalog(message.document.themes).overlays;
        const unregister = registerMountStep(STEP_NAME, {
            start(context): void {
                const store = context.store;
                if (message.icons) writeIcons(store, message.icons);
                if (message.state) {
                    store.apply(DATA_ROOT, message.state.data);
                    applyArticulation(store, '$.app', message.state.app);
                }
            }
        });
        let app: MountedApp;
        try {
            app = mountApp(options.host ?? win.document.body, message.document, library, {
                transferFile: files.transferFile,
                onEmit(name, payload) {
                    const json = payload === undefined ? undefined : toJson(payload);
                    post({ type: 'emit', name, ...(json === undefined ? {} : { payload: json }) });
                },
                onError(error) {
                    postErrors([error]);
                }
            });
        } finally {
            unregister();
        }
        if (!app.store) {
            postErrors(app.errors);
            return;
        }
        mounted = app;
        const listener = (): void => scheduleSnapshot();
        app.store.on(WATCHED, listener);
        watching = { store: app.store, listener };
        if (app.errors.length > 0) postErrors(app.errors);
        post({ type: 'ready' });
    }

    function applyWrite(store: NonNullable<MountedApp['store']>, write: PathWrite): BuildError | undefined {
        const done = write.remove === true ? store.delete(write.path) : store.set(write.path, write.value as never);
        return done ? undefined : buildError('SUI-RUN-WRITE', { path: write.path, statePath: write.path });
    }

    function writes(message: WriteMessage): void {
        const store = mounted?.store;
        if (!store) {
            dropped.unhandled += 1;
            return;
        }
        if (message.icons) writeIcons(store, message.icons);
        const refused: BuildError[] = [];
        for (const write of message.writes) {
            let error: BuildError | undefined;
            try {
                error = applyWrite(store, write);
            } catch (thrown) {
                report.error('runtime write failed', { path: write.path, reason: String(thrown) });
                error = buildError('SUI-RUN-WRITE', { path: write.path, statePath: write.path });
            }
            if (error) refused.push(error);
        }
        if (refused.length > 0) postErrors(refused);
        postSnapshot();
    }

    function command(message: CommandMessage): void {
        const store = mounted?.store;
        if (!store) {
            dropped.unhandled += 1;
            return;
        }
        const run = { host: options.host ?? win.document.body, store: store as unknown as CommandContext['store'], library };
        const error = runCommandMessage(run, message.target, message.command, message.value);
        if (error) postErrors([error]);
    }

    function locale(message: LocaleMessage): void {
        if (!mounted?.store) {
            dropped.unhandled += 1;
            return;
        }
        const errors = localeStep.switchTo(message.locale);
        if (errors.length > 0) postErrors(errors);
    }

    function theme(message: ThemeMessage): void {
        const store = mounted?.store;
        if (!store) {
            dropped.unhandled += 1;
            return;
        }
        const errors = applyOverlay(store as unknown as ThemeStore, message.kind, message.name, themeOverlays);
        if (errors.length > 0) postErrors(errors);
    }

    function handle(message: InboundMessage): void {
        switch (message.type) {
            case 'load':
                load(message);
                return;
            case 'write':
                writes(message);
                return;
            case 'command':
                command(message);
                return;
            case 'locale':
                locale(message);
                return;
            case 'theme':
                theme(message);
                return;
            case 'fileProgress':
                files.progress(message as FileProgressMessage);
                return;
            case 'fileResult':
                files.result(message as FileResultMessage);
                return;
            case 'ping':
                post({ type: 'pong', id: message.id });
                return;
            default:
                dropped.unhandled += 1;
        }
    }

    function onMessage(event: MessageEvent): void {
        if (event.source !== parent) {
            dropped.foreign += 1;
            return;
        }
        const result = validateMessage(event.data);
        if (!result.ok) {
            dropped[result.reason] += 1;
            return;
        }
        const message = result.message;
        if (message.nonce !== nonce) {
            dropped.foreign += 1;
            return;
        }
        if (!(INBOUND_TYPES as readonly string[]).includes(message.type)) {
            dropped.unhandled += 1;
            return;
        }
        try {
            handle(message as InboundMessage);
        } catch (error) {
            report.error('runtime message failed', { type: message.type, reason: String(error) });
            postErrors([buildError('SUI-RUN-BINDING', { component: 'runtime', path: '$', statePath: '$' })]);
        }
    }

    function onFailure(): void {
        postErrors([buildError('SUI-RUN-BINDING', { component: 'runtime', path: '$', statePath: '$' })]);
    }

    win.addEventListener('message', onMessage);
    win.addEventListener('error', onFailure);
    win.addEventListener('unhandledrejection', onFailure);

    return {
        stats: () => ({ dropped: { ...dropped } }),
        dispose(): void {
            if (disposed) return;
            disposed = true;
            win.removeEventListener('message', onMessage);
            win.removeEventListener('error', onFailure);
            win.removeEventListener('unhandledrejection', onFailure);
            teardown();
            files.cancelAll();
            localeStep.unregister();
        }
    };
}
