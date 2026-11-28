import { report } from '@punyts/core';
import { SYNC_ORIGIN, captureChanges } from '@punyts/state-sync';
import { LOGIC_ORIGIN } from '../core/logic/index.js';
import type { Capture, Change } from '@punyts/state-sync';
import { buildError } from '../core/errors/index.js';
import { pathsOfId } from '../core/on/resolveTarget.js';
import { appIconNames } from '../core/icons/appIcons.js';
import type { BuildError } from '../core/errors/index.js';
import { entryShape } from '../core/resolve/index.js';
import type { ComponentLibrary } from '../core/resolve/index.js';
import { isNodeValue } from '../core/resolve/merge.js';
import type { FunctionCatalog } from '../core/functions/index.js';
import type { ComponentOverlays } from '../core/locale/index.js';
import { buildOverlayCatalog } from '../core/theme/index.js';
import type { ThemeOverlays } from '../core/theme/index.js';
import { PREFIXES } from '../core/types.js';
import type { JsonValue } from '../core/types.js';
import { LOCALE_STEP_NAME, createLocaleStep } from '../dom/locale/index.js';
import { mountApp, mountSteps, registerMountStep } from '../dom/mount/index.js';
import type { MountedApp } from '../dom/mount/index.js';
import type { AppHost } from '../dom/embed/types.js';
import type { CommandContext } from '../dom/on/commands.js';
import { applyOverlay } from '../dom/theme/index.js';
import type { ThemeStore } from '../dom/theme/index.js';
import { createFileReads } from './fileRead.js';
import { createFileUrls } from './fileUrl.js';
import { createFileTransfers } from './fileTransfer.js';
import { createFileExports } from './fileExport.js';
import { describeNode, nodesAt, nodesOf, rectOf } from './inspect.js';
import { MAX_ERROR_TEXT, MAX_ERRORS } from './limits.js';
import { createChunkLoader } from './load3d.js';
import { INBOUND_TYPES, MAX_FLOATING, POPOVER_TOGGLE_EVENT, PROTOCOL_VERSION } from './messages.js';
import type {
    CommandMessage,
    InspectedNode,
    InspectRect,
    EventMessage,
    FileDataMessage,
    FileProgressMessage,
    FileReleasedMessage,
    FileExportedMessage,
    FileResultMessage,
    IconsMap,
    InboundMessage,
    InspectMessage,
    WatchMessage,
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
/** How long after a change the runtime looks for read files no node uses any more, in milliseconds */
const FILE_RELEASE_DELAY_MS = 1000;
/** A key Shift makes of another, named by the key it is on in a host's chord (`mod+shift+=` for Ctrl+Shift+=) */
const SHIFTED: Readonly<Record<string, string>> = { '+': '=', _: '-' };
/** The branches whose values can hold a file reference: the app node, the screens and the data */
const FILE_USE_ROOTS = ['$.app', '$.screens', DATA_ROOT];

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
    /** Where the 3D chunk scripts are, ending in `/`: beside the frame's page (`./`) when absent */
    chunkBase?: string;
    /**
     * The function catalogs the page installs (`MountOptions.functions`): the component library's own, whose functions
     * its components call. None when absent
     */
    functions?: readonly FunctionCatalog[];
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
/** The node trees a host write may mount a node in: the app node and the screens */
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

/** What `createRuntime` needs besides `RuntimeOptions`: where the app goes, the nonce and how messages leave */
export interface RuntimeCoreOptions extends Omit<RuntimeOptions, 'host'> {
    /** The element the application is mounted on: a frame's body, or an element of the page */
    readonly host: Element;
    /** The nonce every message in and out carries */
    readonly nonce: string;
    readonly library: ComponentLibrary;
    /** Sends a message of the runtime to its host; `transfer` holds the buffers it moves (`file`) */
    readonly post: (message: Record<string, unknown>, transfer?: Transferable[]) => void;
    /**
     * True when the host element is part of a larger page (an app inside another, not a frame): the app is mounted
     * `embedded`, and `inspect` and `watch` find only its own nodes and answer in the host element's own pixels,
     * before any zoom around it
     */
    readonly inPage?: boolean;
    /**
     * The page's app host (`MountOptions.apps`), for the `embeddedApp` nodes of an app in the page: every load mounts
     * with it. None when absent, and an `embeddedApp` then shows its label
     */
    readonly apps?: AppHost;
}

/** A runtime without its transport: the host hands it messages, and it posts its own through `post` */
export interface RuntimeCore {
    /** Handles one message of the host: dropped (and counted) when it is not valid, has another nonce or is not inbound */
    handle(data: unknown): void;
    /** The app mounted now; undefined before the first load and after a load that failed */
    app(): MountedApp | undefined;
    /** Posts the host's chord for a key it named (`LoadMessage.keys`) and stops the event; others go to the app */
    key(event: KeyboardEvent): void;
    /** Reports a failure of the page the app runs in (an error or a rejection) as `SUI-RUN-BINDING` */
    failure(event: Event): void;
    /** Counts a message from another source */
    foreign(): void;
    /** A copy of the counters */
    stats(): RuntimeStats;
    /** Removes the listeners and the mounted application. Safe to call more than once */
    dispose(): void;
}

/**
 * The runtime, apart from how its messages travel: `startRuntime` hands it a frame's `message` events, and a page that
 * mounts an app in one of its own elements calls `handle` itself. A message is acted on only when it passes
 * `validateMessage` and its `nonce` is `nonce`; anything else is dropped and counted (`stats()`).
 *
 * - `load` mounts the application with `mountApp` in the message's `mode` (a running one is disposed first), with its
 *   `instance` laid over the definition (`MountOptions.instance`), puts the state over it and writes the `icons` map to `$.runtime.icons` before the first render (the document's own `icons` are there
 *   already and win over a host icon of the same name), then posts `ready`. A
 *   document that does not mount posts `error` with the errors and no `ready`.
 * - `write` sets or removes paths of the synced branches (`$.data`, `$.app`, `$.screens`, `$.theme`, `$.locale`; a
 *   whole node below `$.app` or `$.screens.{name}` is mounted as a load would; `$.route` is protected, so a write of it
 *   is refused: the host moves it with a `navigate` command) and of the sync status `$.runtime.sync`, as sync
 *   writes: they post no `change`. It merges its `icons` into `$.runtime.icons`, but for the document's own.
 * - `event` raises an app event (`sync.rejected`, `sync.requested`): the root node's `on` entry for it runs with the
 *   payload, or else the app's toasts show the event's notice. `write` also reaches `$.runtime.requests`, the requests
 *   the host's sync client knows (docs/design/statenet-requests.md).
 * - `ping` is answered with `pong`, and `inspect` with `inspected` (the nodes on screen, for an editor over the frame).
 * - `command` runs a component command with the runner the dispatcher uses for `on` (`target` is a `$.app` node path;
 *   the other system commands are refused). `locale` applies a language overlay (`switchLocale`,
 *   from the document's `locales` and `options.componentOverlays`) and leaves `$.data` alone. `theme` applies the
 *   overlay `name` of `kind` (`applyOverlay`: the shipped overlays and the document's `themes`). A failure posts
 *   `error` and changes nothing. With no application mounted these, `write` and `event` are counted as `unhandled`.
 *
 * It posts one `change` for each change of the store that is not a host write (`captureChanges` of
 * `@punyts/state-sync`: a user's typing, a controller, a command), batched to a microtask and folded; `$.runtime`,
 * `$.server`, link aliases and the runtime properties of a node (`"runtime": true` in its shape) make none, and a
 * snapshot or a write does not set a runtime property. The value of an `inputType: "password"` field (and the data such a field is
 * linked to) never leaves the frame: such a change is not posted, and it is cut out of the value of a change above it.
 * It posts `emit`, `decide` (a `request.*` command), `history` (`undo` or `redo`) from the dispatcher hooks and `error` for validation and
 * runtime errors.
 *
 * Files: the dispatcher's `transferFile` hook posts `file` (answered by `fileProgress` and `fileResult`), its
 * `readFile` hook posts `fileRead` (answered by `fileData`) and its `releaseFile` hook posts `fileRelease` (answered by
 * `fileReleased`; the cached bytes of a released file are dropped); its `exportFile` hook posts `fileExport` (answered by
 * `fileExported`). The bytes of read files are kept by id across loads
 * (`createFileReads`, at most `FILE_CACHE_BYTES`) and released a moment after a change once no value of the app node,
 * the screens or the data holds the id any more; `dispose` cancels the waiting reads and drops them all.
 *
 * Chunks (G3.3): when `load` names a `3d` chunk in `chunks`, the dispatcher gets the `load3d` hook, which a `scene3d`
 * asks with `ui-load-3d`. It adds one `<script src="./<hash>.js">` to the page (`createChunkLoader`), resolves with
 * `globalThis.__stateui3d` once the script has run, rejects with a `Load3dError` (`load_failed`, `script_error`,
 * `timeout` after `CHUNK_LOAD_TIMEOUT_MS`) and returns the same promise on later calls, across loads too. An error the
 * chunk throws while it loads is its load's `script_error`, not a `SUI-RUN-BINDING`. Without `chunks` there is no hook,
 * so the event goes unanswered and the scene shows its `_fallback`; an app with no scene never asks, so the script is
 * never requested.
 */
export function createRuntime(options: RuntimeCoreOptions): RuntimeCore {
    const { host, nonce, library } = options;
    const doc = host.ownerDocument;
    const dropped: DroppedCounts = { invalid: 0, unknown: 0, oversized: 0, unhandled: 0, foreign: 0 };
    let mounted: MountedApp | undefined;
    let capture: Capture | undefined;
    // Registered only while this runtime mounts its own app: another runtime in the page has a locale step of its own
    const localeStep = createLocaleStep(options.componentOverlays ?? {});
    let themeOverlays: ThemeOverlays = buildOverlayCatalog(undefined).overlays;
    let passwordData = new Set<string>();
    let postedErrors = 0;
    let disposed = false;
    /** The key chords the host handles itself (`LoadMessage.keys`) */
    let hostKeys: ReadonlySet<string> = new Set();
    /** The names of the loaded document's own icons, which an icons map from the host never replaces */
    let documentIcons: ReadonlySet<string> = new Set();

    function post(message: { type: OutboundMessage['type'] } & Record<string, unknown>, transfer?: Transferable[]): boolean {
        const full = { v: PROTOCOL_VERSION, nonce, ...message };
        const result = validateMessage(full);
        if (!result.ok) {
            dropped[result.reason] += 1;
            return false;
        }
        options.post(full, transfer);
        return true;
    }

    const files = createFileTransfers({
        sendFile: (message) => post({ type: 'file', ...message }, [message.data]),
        sendCancel: (requestId) => {
            post({ type: 'fileCancel', requestId });
        },
        sendRelease: (requestId, id) => post({ type: 'fileRelease', requestId, id })
    });
    const exports = createFileExports({ sendExport: (message) => post({ type: 'fileExport', ...message }) });

    /**
     * The ids a node still uses: an id is used while it appears anywhere in the values of the app node, the screens or the
     * data (the definition of `isFileReferenced` in `@punyts/stateui-mcp`, which the server's file sweep uses)
     */
    function usedIds(ids: readonly string[]): ReadonlySet<string> {
        const store = mounted?.store;
        if (!store || ids.length === 0) return new Set();
        const text = FILE_USE_ROOTS.map((root) => JSON.stringify(store.get(root as never)) ?? '').join('\n').toLowerCase();
        return new Set(ids.filter((id) => text.includes(id.toLowerCase())));
    }

    const urls = createFileUrls();
    const chunks = createChunkLoader(doc, options.chunkBase === undefined ? {} : { base: options.chunkBase });
    const reads = createFileReads(
        {
            sendRead: (requestId, id) => post({ type: 'fileRead', requestId, id })
        },
        { usedIds }
    );
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;

    /** Releases the read files no node uses, a moment after the state changed; nothing to do while none is kept */
    function scheduleRelease(): void {
        if (releaseTimer !== undefined || reads.cached().length === 0) return;
        releaseTimer = setTimeout(() => {
            releaseTimer = undefined;
            if (!disposed) reads.release();
        }, FILE_RELEASE_DELAY_MS);
    }

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
                scheduleRelease();
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

    /** Writes the host's icons to `$.runtime.icons`, all but those the document carries of its own, which win */
    function writeIcons(store: NonNullable<MountedApp['store']>, icons: IconsMap): void {
        for (const [name, icon] of Object.entries(icons)) if (!documentIcons.has(name)) store.set(`${ICONS_PATH}.${name}`, icon as never);
    }

    function load(message: LoadMessage): void {
        teardown();
        hostKeys = new Set(message.keys ?? []);
        urls.set(message.files);
        documentIcons = appIconNames(message.document.icons);
        passwordData = passwordDataPaths(message.document);
        themeOverlays = buildOverlayCatalog(message.document.themes).overlays;
        const pageLocale = mountSteps().find(([name]) => name === LOCALE_STEP_NAME)?.[1];
        const unregisterLocale = registerMountStep(LOCALE_STEP_NAME, localeStep.step);
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
                host,
                message.document,
                library,
                {
                    transferFile: files.transferFile,
                    readFile: reads.readFile,
                    fileUrl: urls.fileUrl,
                    // A file given back is gone from the host, so its cached bytes go too
                    releaseFile: (id) => files.releaseFile(id).then(() => reads.forget(id)),
                    exportFile: exports.exportFile,
                    // Only a host that serves the 3D chunk names it; without the hook a scene shows its fallback
                    ...(message.chunks?.['3d'] !== undefined && { load3d: chunks.load3d(message.chunks['3d']) }),
                    onRaised(report) {
                        post({ type: 'raised', ...report });
                    },
                    decide(decision) {
                        post({ type: 'decide', ...decision });
                    },
                    travel(step) {
                        post({ type: 'history', step });
                    },
                    onError(error) {
                        postErrors([error]);
                    }
                },
                {
                    mode: message.mode ?? 'standalone',
                    route: options.route ?? false,
                    ...(options.inPage === true && { embedded: true }),
                    ...(options.functions !== undefined && { functions: options.functions }),
                    ...(options.apps !== undefined && { apps: options.apps }),
                    ...(message.instance !== undefined && { instance: message.instance })
                }
            );
        } finally {
            unregister();
            unregisterLocale();
            // A locale step the page registered for its own mounts is its again
            if (pageLocale !== undefined) registerMountStep(LOCALE_STEP_NAME, pageLocale);
        }
        if (!app.store) {
            postErrors(app.errors);
            return;
        }
        mounted = app;
        // Before anything paints and before changes are reported: the host's theme and language are its view, not edits
        for (const [kind, name] of Object.entries(message.active ?? {})) theme({ type: 'theme', kind, name } as ThemeMessage);
        if (message.locale !== undefined) locale({ type: 'locale', locale: message.locale } as LocaleMessage);
        startCapture(app.store);
        if (message.open !== undefined) {
            const { screen, params } = message.open;
            command({ type: 'command', target: screen, command: 'navigate', ...(params !== undefined && { value: params }) } as CommandMessage);
        }
        scheduleRelease();
        if (app.errors.length > 0) postErrors(app.errors);
        post({ type: 'ready' });
    }

    /**
     * The state path a write by id reaches: `#save.hidden` is `hidden` of the one node whose id (its `@id`, otherwise
     * its key) is `save`, looked for as logic looks: in the screen that shows, then the app node, then the other
     * screens, taking the first place that has the id. Undefined when no node has it, or the place has it twice. A
     * node of a row template counts, so an id used only there writes the template
     */
    function pathOfReference(store: NonNullable<MountedApp['store']>, reference: string): string | undefined {
        const dot = reference.indexOf('.');
        if (dot < 2) return undefined;
        const id = reference.slice(1, dot);
        const rest = reference.slice(dot);
        const current: unknown = store.get('$.route.screen' as never);
        const screens: unknown = store.get('$.screens' as never);
        const inScreen = (name: string): string[] => {
            const root: unknown = typeof screens === 'object' && screens !== null ? (screens as Record<string, unknown>)[name] : undefined;
            return isNodeValue(root as never) ? pathsOfId(root as never, `$.screens.${name}`, id) : [];
        };
        const app: unknown = store.get('$.app' as never);
        const others = typeof screens === 'object' && screens !== null ? Object.keys(screens).filter((name) => name !== current) : [];
        const places: string[][] = [
            typeof current === 'string' ? inScreen(current) : [],
            isNodeValue(app as never) ? pathsOfId(app as never, '$.app', id) : [],
            others.flatMap(inScreen)
        ];
        const found = places.find((place) => place.length > 0);
        return found?.length === 1 ? (found[0] as string) + rest : undefined;
    }

    /**
     * Applies one host write. A path that starts with `#` names a node by its id (`#save.hidden`), so a host keeps a
     * node's own state on the node without knowing where the node is. A whole node below `$.app` (a value with a `component`) is mounted as a load would
     * mount it, and removing a node removes its links; every other write is a plain store write
     */
    function applyWrite(app: MountedApp, store: NonNullable<MountedApp['store']>, asked: PathWrite): BuildError[] {
        let write = asked;
        if (asked.path.startsWith('#')) {
            const path = pathOfReference(store, asked.path);
            if (path === undefined) return asked.optional === true ? [] : [buildError('SUI-RUN-WRITE', { path: asked.path, statePath: asked.path })];
            write = { ...asked, path };
        }
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
        scheduleRelease();
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
            host,
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
        // `system` is no overlay: written as the active name, the mode (or motion) follows the device again
        if (message.name === 'system' && (message.kind === 'mode' || message.kind === 'motion')) {
            store.set(`$.theme.active.${message.kind}` as never, 'system' as never);
            return;
        }
        const errors = applyOverlay(store as unknown as ThemeStore, message.kind, message.name, themeOverlays);
        if (errors.length > 0) postErrors(errors);
    }

    /** How many page pixels one pixel of the host is: the zoom of the page around it, 1 in a frame */
    function scale(): number {
        if (options.inPage !== true || !(host instanceof HTMLElement) || host.offsetWidth === 0) return 1;
        return host.getBoundingClientRect().width / host.offsetWidth || 1;
    }

    /** A point in the host's pixels as a point of the page */
    function toClient(x: number, y: number): { x: number; y: number } {
        if (options.inPage !== true) return { x, y };
        const box = host.getBoundingClientRect();
        const zoom = scale();
        return { x: box.x + x * zoom, y: box.y + y * zoom };
    }

    /** A rect of the page in the host's pixels */
    function hostRect(rect: InspectRect): InspectRect {
        if (options.inPage !== true) return rect;
        const box = host.getBoundingClientRect();
        const zoom = scale();
        const round = (value: number): number => Math.round(value * 10) / 10;
        return { x: round((rect.x - box.x) / zoom), y: round((rect.y - box.y) / zoom), width: round(rect.width / zoom), height: round(rect.height / zoom) };
    }

    /** A node's description with every rect in the host's pixels */
    function inHostPixels(node: InspectedNode): InspectedNode {
        if (options.inPage !== true) return node;
        return {
            ...node,
            rect: hostRect(node.rect),
            ...(node.area !== undefined && { area: { ...node.area, rect: hostRect(node.area.rect) } }),
            ...(node.children !== undefined && { children: node.children.map((child) => ({ ...child, rect: hostRect(child.rect) })) })
        };
    }

    /** Whether an element is inside the host, across shadow roots: in a page, another app's nodes are not this one's */
    function isMine(element: Element): boolean {
        if (options.inPage !== true) return true;
        for (let at: Node | null = element; at; at = at instanceof ShadowRoot ? at.host : at.parentNode) if (at === host) return true;
        return false;
    }

    /** The node elements of some paths in this app: in a page, looked for only inside its element, since another app there may have the same paths */
    function mineOf(paths: readonly string[]): Map<string, Element> {
        return nodesOf(options.inPage === true ? host : doc, paths);
    }

    /** Answers an editor over the frame or the page: the node at a point and its ancestors, or the nodes of some paths */
    function inspect(message: InspectMessage): void {
        const store = mounted?.store;
        const componentOf = (path: string): string | undefined => {
            const name = store?.get(`${path}.component` as never) as unknown;
            return typeof name === 'string' ? name : undefined;
        };
        const describe = (element: Element): InspectedNode => inHostPixels(describeNode(element, componentOf));
        if (message.at !== undefined) {
            const point = toClient(message.at.x, message.at.y);
            const chain = nodesAt(doc, point.x, point.y, options.inPage === true ? host : undefined).filter(isMine);
            const at = chain[0]?.getAttribute('state') ?? undefined;
            post({ type: 'inspected', id: message.id, ...(at !== undefined && { at }), nodes: chain.map(describe) });
            return;
        }
        const found = mineOf(message.paths ?? []);
        post({ type: 'inspected', id: message.id, nodes: [...found.values()].map(describe) });
    }

    // The nodes an editor over the frame watches (`watch`): their boxes go out as `watched` when they change, with the
    // boxes of the popovers open now (tips, menus, lists), which may lie outside every watched node
    let watched: string[] = [];
    const floating = new Set<HTMLElement>();
    const onPopover = (event: Event): void => {
        const element = event.composedPath()[0];
        if (!(element instanceof HTMLElement) || !isMine(element)) return;
        if ((event as CustomEvent<{ open?: unknown }>).detail?.open === true) floating.add(element);
        else floating.delete(element);
        reportWatched();
    };
    doc.addEventListener(POPOVER_TOGGLE_EVENT, onPopover);
    let lastWatched = '';
    let watchFrame = 0;
    const watchResize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => reportWatched()) : undefined;
    function reportWatched(): void {
        if (watched.length === 0 || watchFrame !== 0) return;
        // A timer, not an animation frame: a frame the page has clipped away gets no animation frames, and it must still
        // say where its nodes are for the page to show it again
        watchFrame = Number(setTimeout(() => {
            watchFrame = 0;
            const found = mineOf(watched);
            watchResize?.disconnect();
            if (watchResize) {
                watchResize.observe(options.inPage === true ? host : doc.documentElement);
                for (const element of found.values()) watchResize.observe(element);
            }
            for (const element of floating) if (!element.isConnected) floating.delete(element);
            if (watchResize) for (const element of floating) watchResize.observe(element);
            const nodes = [...found.entries()].map(([path, element]) => ({ path, rect: hostRect(rectOf(element)) }));
            const popovers = [...floating].slice(0, MAX_FLOATING).map((element) => hostRect(rectOf(element)));
            const text = JSON.stringify([nodes, popovers]);
            if (text === lastWatched) return;
            lastWatched = text;
            post({ type: 'watched', nodes, ...(popovers.length > 0 && { floating: popovers }) });
        }, 16));
    }
    function watch(message: WatchMessage): void {
        watched = message.paths.slice();
        lastWatched = '';
        if (watched.length === 0) {
            watchResize?.disconnect();
            return;
        }
        reportWatched();
    }
    const view = doc.defaultView;
    const onResize = (): void => reportWatched();
    view?.addEventListener('resize', onResize);

    function handle(message: InboundMessage): void {
        switch (message.type) {
            case 'load':
                load(message);
                reportWatched();
                return;
            case 'write':
                writes(message);
                reportWatched();
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
            case 'grant':
                urls.grant(message.grant);
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
            case 'fileData':
                reads.data(message as FileDataMessage);
                return;
            case 'fileReleased':
                files.released(message as FileReleasedMessage);
                return;
            case 'fileExported':
                exports.exported(message as FileExportedMessage);
                return;
            case 'ping':
                post({ type: 'pong', id: message.id });
                return;
            case 'inspect':
                inspect(message);
                return;
            case 'watch':
                watch(message);
                return;
            default:
                dropped.unhandled += 1;
        }
    }

    function onMessage(data: unknown): void {
        const result = validateMessage(data);
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
        // A chunk script that throws while it loads fails its load, which the scene reports as SUI-RUN-3D
        if (chunks.owns(event)) return;
        postErrors([buildError('SUI-RUN-BINDING', { component: 'runtime', path: '$', statePath: '$' })]);
    }

    /** True while the person types: the focus is in a text field, a select or editable text, also inside a component */
    function typing(event: KeyboardEvent): boolean {
        const target = event.composedPath()[0];
        if (!(target instanceof HTMLElement)) return false;
        if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
        return target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'color', 'file', 'image'].includes(target.type);
    }

    /**
     * A chord the host named goes to the host, and not to the app. One without `mod` (a bare key, or Escape) goes only
     * while the person is not typing, so the host can take single keys and a text field still gets its letters. With
     * Shift, `+` is named `shift+=` and `_` `shift+-`, the keys they are on, so a host can name Ctrl+Shift+= and
     * Ctrl+Shift+-
     */
    function onKey(event: KeyboardEvent): void {
        if (hostKeys.size === 0) return;
        const named = event.key === 'Escape' ? 'escape' : event.key.length === 1 ? event.key.toLowerCase() : '';
        const key = event.shiftKey ? (SHIFTED[named] ?? named) : named;
        if (key === '') return;
        const mod = event.ctrlKey || event.metaKey;
        const chord = `${mod ? 'mod+' : ''}${event.shiftKey && key.length === 1 && /[a-z0-9=-]/.test(key) ? 'shift+' : ''}${event.altKey ? 'alt+' : ''}${key}`;
        if (!hostKeys.has(chord)) return;
        if (!mod && typing(event)) return;
        event.preventDefault();
        event.stopPropagation();
        post({ type: 'key', key: chord });
    }

    return {
        handle: onMessage,
        app: () => mounted,
        key: onKey,
        failure: onFailure,
        foreign: () => {
            dropped.foreign += 1;
        },
        stats: () => ({ dropped: { ...dropped } }),
        dispose(): void {
            if (disposed) return;
            disposed = true;
            doc.removeEventListener(POPOVER_TOGGLE_EVENT, onPopover);
            view?.removeEventListener('resize', onResize);
            watchResize?.disconnect();
            if (watchFrame !== 0) clearTimeout(watchFrame);
            teardown();
            files.cancelAll();
            reads.cancelAll();
            exports.cancelAll();
            chunks.dispose();
            if (releaseTimer !== undefined) clearTimeout(releaseTimer);
        }
    };
}
