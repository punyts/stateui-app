import { report } from '@punyts/core';
import { SYNC_ORIGIN, captureChanges } from '@punyts/state-sync';
import { LOGIC_ORIGIN } from '../core/logic/index.js';
import type { Capture, Change } from '@punyts/state-sync';
import { buildError } from '../core/errors/index.js';
import type { BuildError } from '../core/errors/index.js';
import { entryShape } from '../core/resolve/index.js';
import type { ComponentLibrary } from '../core/resolve/index.js';
import { isNodeValue } from '../core/resolve/merge.js';
import type { ComponentOverlays } from '../core/locale/index.js';
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
    EventMessage,
    FileProgressMessage,
    FileResultMessage,
    IconsMap,
    InboundMessage,
    LoadMessage,
    LocaleMessage,
    OutboundMessage,
    PathWrite,
    ProtocolError,
    RuntimeChange,
    ThemeMessage,
    WriteMessage
} from './messages.js';
import { runCommandMessage } from './runCommandMessage.js';
import { isRuntimeProperty } from './runtimeProperties.js';
import { validateMessage } from './validate.js';

const STEP_NAME = 'runtime-load';
const ICONS_PATH = '$.runtime.icons';
const DATA_ROOT = '$.data';
/** The runtime posts at most this many errors in its life, so a failing app cannot flood the host */
const MAX_POSTED_ERRORS = 200;
/** Window errors that report no failure: a ResizeObserver whose callback changed layout leaves notifications for the next frame */
const BENIGN_ERROR = /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/;

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
    /**
     * Whether an app with screens keeps `$.route` in the URL fragment (`MountOptions.route`). False when absent: the
     * runtime runs in a frame of its host, where a history entry would also move the host page's back button
     */
    route?: boolean;
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

/** Writes from the host are sync writes: the store tags their events, so capture does not post them back */
const SYNC_WRITE = { origin: SYNC_ORIGIN };
/** Paths below the app tree, where a written node is mounted rather than stored */
/** The node trees a host write may mount a node in: the shell and the screens */
const NODE_PREFIXES = ['$.app.', '$.screens.'];

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

/**
 * Starts the runtime inside the iframe. It listens on `win` for `message` events and acts on a message only when
 * `event.source === parent` (pass `window.parent`), it passes `validateMessage` and its `nonce` is `nonce`; anything
 * else is dropped and counted (`stats()`).
 *
 * - `load` mounts the application with `mountApp` in the message's `mode` (a running one is disposed first), with its
 *   `instance` laid over the definition (`MountOptions.instance`), puts the state over it and writes the `icons` map to `$.runtime.icons` before the first render, then posts `ready`. A
 *   document that does not mount posts `error` with the errors and no `ready`.
 * - `write` sets or removes paths of the synced branches (`$.data`, `$.app`, `$.screens`, `$.theme`, `$.locale`; a
 *   whole node below `$.app` or `$.screens.{name}` is mounted as a load would; `$.route` is protected, so a write of it
 *   is refused: the host moves it with a `navigate` command) and of the sync status `$.runtime.sync`, as sync
 *   writes: they post no `change`. It merges its `icons` into `$.runtime.icons`.
 * - `event` raises an app event (`sync.rejected`): the root node's `on` entry for it runs with the payload.
 * - `ping` is answered with `pong`.
 * - `command` runs a component command with the runner the dispatcher uses for `on` (`target` is a `$.app` node path;
 *   the system commands `set`, `toggle` and `emit` are refused). `locale` applies a language overlay (`switchLocale`,
 *   from the document's `locales` and `options.componentOverlays`) and leaves `$.data` alone. `theme` applies the
 *   overlay `name` of `kind` (`applyOverlay`: the shipped overlays and the document's `themes`). A failure posts
 *   `error` and changes nothing. With no application mounted these, `write` and `event` are counted as `unhandled`.
 *
 * It posts one `change` for each change of the store that is not a host write (`captureChanges` of
 * `@punyts/state-sync`: a user's typing, a controller, a command), batched to a microtask and folded; `$.runtime`,
 * `$.server`, link aliases and the runtime properties of a node (`"runtime": true` in its shape) make none, and a
 * snapshot or a write does not set a runtime property. The value of an `inputType: "password"` field (and the data such a field is
 * linked to) never leaves the frame: such a change is not posted, and it is cut out of the value of a change above it.
 * It posts `emit` from the dispatcher hook and `error` for validation and runtime errors.
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
    let capture: Capture | undefined;
    const localeStep = registerLocaleStep(options.componentOverlays ?? {});
    let themeOverlays: ThemeOverlays = buildOverlayCatalog(undefined).overlays;
    let passwordData = new Set<string>();
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

    /** A password field's value, or the data such a field is linked to */
    function isSecret(store: NonNullable<MountedApp['store']>, path: string): boolean {
        if (passwordData.has(path)) return true;
        if (!path.startsWith('$.app.') || !path.endsWith('.value')) return false;
        const owner: unknown = store.get(path.slice(0, path.lastIndexOf('.')));
        return isRecord(owner) && owner['inputType'] === 'password';
    }

    /** What never leaves the frame: a secret, or a runtime property the component computes itself on every mount */
    function isKept(store: NonNullable<MountedApp['store']>, path: string): boolean {
        return isSecret(store, path) || isRuntimeProperty(store, library, path);
    }

    /** A copy of the value without the secrets and runtime properties below `path` */
    function withoutSecrets(store: NonNullable<MountedApp['store']>, path: string, value: JsonValue): JsonValue {
        if (Array.isArray(value)) return value.map((item, index) => withoutSecrets(store, `${path}.${index}`, item));
        if (!isRecord(value)) return value;
        const kept: Record<string, JsonValue> = {};
        for (const [key, item] of Object.entries(value)) {
            const child = `${path}.${key}`;
            if (!isKept(store, child)) kept[key] = withoutSecrets(store, child, item as JsonValue);
        }
        return kept;
    }

    /**
     * Whether a snapshot value may be written at a key the store does not hold yet. On a node only a declared property
     * that is not a slot (`items` and `total` that logic fills, `error`); in a node's `children` nothing, as the child
     * node is gone from the document; inside any other value (a map of records) every key
     */
    function mayCreate(parent: Record<string, unknown>, key: string, inChildren: boolean): boolean {
        if (inChildren) return false;
        const component = parent['component'];
        if (typeof component !== 'string') return true;
        const shape = entryShape(library[component]);
        const property = shape !== undefined && Object.hasOwn(shape.properties, key) ? shape.properties[key] : undefined;
        if (property === undefined) return false;
        const types = Array.isArray(property.type) ? property.type : [property.type];
        return !types.includes('node');
    }

    /**
     * True when `key` of the node `parent` is the record collection of a record view (`records`, `items`): a query
     * writes it whole, so a stored value replaces the document's value instead of merging into it (which would keep
     * seeded records the query left out)
     */
    function isRecordCollection(parent: Record<string, unknown>, key: string): boolean {
        if (key !== 'records' && key !== 'items') return false;
        const component = parent['component'];
        if (typeof component !== 'string') return false;
        const shape = entryShape(library[component]);
        return shape !== undefined && Object.hasOwn(shape.properties, key);
    }

    /** Writes the articulation values of a snapshot over the mounted app; a value for a vanished node or a runtime property is skipped */
    function applyArticulation(store: NonNullable<MountedApp['store']>, path: string, value: unknown, inChildren = false): void {
        const current = store.get(path);
        if (!isRecord(value) || !isRecord(current)) {
            if (value !== undefined) store.set(path, value as never);
            return;
        }
        for (const [key, item] of Object.entries(value)) {
            const child = `${path}.${key}`;
            if (isRuntimeProperty(store, library, child)) continue;
            if (store.get(child) === undefined && !mayCreate(current, key, inChildren)) continue;
            if (!inChildren && isRecordCollection(current, key)) {
                store.set(child, item as never);
                continue;
            }
            applyArticulation(store, child, item, key === 'children' && typeof current['component'] === 'string');
        }
    }

    /** The change as posted: no base (the host's sync client gives it one), no secrets or runtime properties; undefined when it is one */
    function postable(store: NonNullable<MountedApp['store']>, change: Change): RuntimeChange | undefined {
        if (isKept(store, change.path)) return undefined;
        const { id, path, op } = change;
        return change.value === undefined ? { id, path, op } : { id, path, op, value: withoutSecrets(store, path, change.value) };
    }

    function startCapture(store: NonNullable<MountedApp['store']>): void {
        capture = captureChanges(store, {
            base: () => 0,
            origins: [LOGIC_ORIGIN],
            onChanges(changes) {
                if (disposed) return;
                for (const change of changes) {
                    const kept = postable(store, change);
                    if (kept) post({ type: 'change', change: kept });
                }
            }
        });
    }

    function teardown(): void {
        files.cancelAll();
        capture?.stop();
        capture = undefined;
        mounted?.dispose();
        mounted = undefined;
    }

    function writeIcons(store: NonNullable<MountedApp['store']>, icons: IconsMap): void {
        for (const [name, icon] of Object.entries(icons)) store.set(`${ICONS_PATH}.${name}`, icon as never);
    }

    function load(message: LoadMessage): void {
        teardown();
        passwordData = passwordDataPaths(message.document);
        themeOverlays = buildOverlayCatalog(message.document.themes).overlays;
        const unregister = registerMountStep(STEP_NAME, {
            start(context): void {
                const store = context.store;
                if (message.icons) writeIcons(store, message.icons);
                if (message.state) {
                    // The state's data is the whole of $.data (snapshotState copies it), so it replaces the document's:
                    // a merge would keep the tail of a longer seeded list and the keys the state no longer has
                    if (isRecord(message.state.data)) store.set(DATA_ROOT, message.state.data as never);
                    applyArticulation(store, '$.app', message.state.app);
                }
            }
        });
        let app: MountedApp;
        try {
            app = mountApp(
                options.host ?? win.document.body,
                message.document,
                library,
                {
                    transferFile: files.transferFile,
                    onEmit(name, payload) {
                        const json = payload === undefined ? undefined : toJson(payload);
                        post({ type: 'emit', name, ...(json === undefined ? {} : { payload: json }) });
                    },
                    onError(error) {
                        postErrors([error]);
                    }
                },
                { mode: message.mode ?? 'standalone', route: options.route ?? false, ...(message.instance !== undefined && { instance: message.instance }) }
            );
        } finally {
            unregister();
        }
        if (!app.store) {
            postErrors(app.errors);
            return;
        }
        mounted = app;
        startCapture(app.store);
        if (app.errors.length > 0) postErrors(app.errors);
        post({ type: 'ready' });
    }

    /**
     * Applies one host write. A whole node below `$.app` (a value with a `component`) is mounted as a load would
     * mount it, and removing a node removes its links; every other write is a plain store write
     */
    function applyWrite(app: MountedApp, store: NonNullable<MountedApp['store']>, write: PathWrite): BuildError[] {
        // A runtime property the host still has from an older view is the component's own, so it is not written over
        if (isRuntimeProperty(store, library, write.path)) return [];
        const inApp = NODE_PREFIXES.some((prefix) => write.path.startsWith(prefix));
        if (inApp && write.remove !== true && isNodeValue(write.value)) return app.writeNode(write.path, write.value as never, SYNC_WRITE);
        let done: boolean;
        if (write.remove === true) done = inApp && isNodeValue(store.get(write.path as never)) ? app.removeNode(write.path, SYNC_WRITE) : store.delete(write.path, SYNC_WRITE);
        else done = store.set(write.path, write.value as never, SYNC_WRITE);
        return done ? [] : [buildError('SUI-RUN-WRITE', { path: write.path, statePath: write.path })];
    }

    function writes(message: WriteMessage): void {
        const app: MountedApp = mounted as MountedApp;
        const store = app?.store;
        if (!app || !store) {
            dropped.unhandled += 1;
            return;
        }
        if (message.icons) writeIcons(store, message.icons);
        const refused: BuildError[] = [];
        for (const write of message.writes) {
            try {
                refused.push(...applyWrite(app, store, write));
            } catch (thrown) {
                report.error('runtime write failed', { path: write.path, reason: String(thrown) });
                refused.push(buildError('SUI-RUN-WRITE', { path: write.path, statePath: write.path }));
            }
        }
        if (refused.length > 0) postErrors(refused);
    }

    function appEvent(message: EventMessage): void {
        if (!mounted?.store) {
            dropped.unhandled += 1;
            return;
        }
        mounted.raise(message.name, message.payload);
    }

    function command(message: CommandMessage): void {
        const store = mounted?.store;
        if (!store) {
            dropped.unhandled += 1;
            return;
        }
        const app: MountedApp = mounted as MountedApp;
        const run = {
            host: options.host ?? win.document.body,
            store: store as unknown as CommandContext['store'],
            library,
            navigate: (screen: string, params: JsonValue | undefined) => app.navigate(screen, params)
        };
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
            case 'event':
                appEvent(message);
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

    function onFailure(event: Event): void {
        // The browser raises this when a resize handler changes layout again; nothing failed
        if (event instanceof ErrorEvent && event.error == null && BENIGN_ERROR.test(event.message)) return;
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
