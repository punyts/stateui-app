import { report } from '@punyts/core';
import { buildError } from '../../core/errors/index.js';
import type { BuildError } from '../../core/errors/index.js';
import { readEntry } from '../../core/on/index.js';
import type { Frame, TreeNode } from '../../core/on/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { isNodeValue } from '../../core/resolve/merge.js';
import { runtimePath } from '../../core/links/index.js';
import { RESERVED_KEYS } from '../../core/types.js';
import { CommandFailure, runCommand } from './commands.js';
import type { CommandContext } from './commands.js';
import { FILE_READ_EVENT, FILE_TRANSFER_EVENT } from './types.js';
import type { Dispatcher, DispatcherOptions, FileReadRequest, FileTransferRequest } from './types.js';

const DEFAULT_ROOT = '$.app';
const RUNTIME_NODES = '$.runtime.nodes.';


/** The names of the events every root component of the library declares */
function eventNames(library: ComponentLibrary): Set<string> {
    const names = new Set<string>();
    for (const entry of Object.values(library)) {
        if (entry.tier === 'root') for (const event of entry.shape.events) names.add(event);
    }
    return names;
}

/**
 * The tags of the library's root components: the elements the dispatcher hears events from. A composed component has
 * no element of its own and a shape component is drawn, never mounted, so neither has a tag
 */
export function componentTags(library: ComponentLibrary): Set<string> {
    const result = new Set<string>();
    for (const entry of Object.values(library)) if (entry.tier === 'root') result.add(entry.tag);
    return result;
}

function isFileTransfer(value: unknown): value is FileTransferRequest {
    if (typeof value !== 'object' || value === null) return false;
    const request = value as Partial<FileTransferRequest>;
    return request.file instanceof File && typeof request.respond === 'function';
}

function isFileRead(value: unknown): value is FileReadRequest {
    if (typeof value !== 'object' || value === null) return false;
    const request = value as Partial<FileReadRequest>;
    return typeof request.id === 'string' && request.id.length > 0 && typeof request.respond === 'function';
}

/** The element that raised the event: the first one on its path that is a library component with a scope */
function raisedBy(event: Event, componentTags: ReadonlySet<string>): { path: string } | undefined {
    for (const target of event.composedPath()) {
        if (!(target instanceof Element) || !componentTags.has(target.localName)) continue;
        const path = (target as { scope?: { basePath?: unknown } }).scope?.basePath;
        return typeof path === 'string' ? { path } : undefined;
    }
    return undefined;
}

/**
 * Listens on `host` for the events root components raise and runs the `on` entry of the node that raised them.
 *
 * A component raises an event on its own element with `bubbles` and `composed` set, and its `detail` is the payload:
 * `element.dispatchEvent(new CustomEvent('press', { detail, bubbles: true, composed: true }))`. The node is the one
 * at the element's state path. An event the node's `on` does not mention does nothing.
 *
 * The entry runs in order. A command that fails (an unresolved target, a write the store refuses, `toggle` on a value
 * that is not a boolean, a component command nothing handles, a handler or hook that throws) is reported as `SUI-RUN`
 * with the node's state path, and the commands after it do not run
 */
export function createDispatcher(options: DispatcherOptions): Dispatcher {
    const { host, store, library, hooks } = options;
    const rootPath = options.rootPath ?? DEFAULT_ROOT;
    const roots = [rootPath, ...(options.roots ?? [])];
    const instances = options.instances ?? {};
    const tags = componentTags(library);
    const names = eventNames(library);

    /** The root (`rootPath` or one of `roots`) that `path` is at or below */
    function rootOf(path: string): string | undefined {
        return roots.find((root) => path === root || path.startsWith(`${root}.`));
    }

    /** Frames from the root that holds `path` down to it; undefined when `path` is not a node below a root */
    function chainTo(path: string): Frame[] | undefined {
        const base = rootOf(path);
        if (base === undefined) return undefined;
        const steps = path === base ? [] : path.slice(base.length + 1).split('.');
        const chain: Frame[] = [];
        let current = base;
        for (let index = -1; index < steps.length; index += 1) {
            if (index >= 0) current = `${current}.${steps[index] as string}`;
            const value: unknown = store.get(current);
            if (!isNodeValue(value)) continue;
            chain.push({
                path: current,
                key: current.slice(current.lastIndexOf('.') + 1),
                node: value as TreeNode,
                instances: Object.hasOwn(instances, current) ? (instances[current] as string[]) : []
            });
        }
        const last = chain[chain.length - 1];
        return last?.path === path ? chain : undefined;
    }

    /**
     * The frames of a node in the runtime branch (a record-view slot or a table cell): the node that owns it, found
     * as the longest proper prefix of its app path that is a node of `$.app`, and then the runtime nodes below it.
     * A prefix that is a node only through a runtime alias (`$.app.list.slots.3`, whose runtime path holds the same
     * node) is a slot, not the owner. `owner` is the owner's chain; `rowPath` is the `row` alias of the nearest slot at
     * or above the node
     */
    function runtimeChain(path: string): { chain: Frame[]; owner: Frame[]; rowPath?: string } | undefined {
        let candidate = `$.${path.slice(RUNTIME_NODES.length)}`;
        let owner: Frame[] | undefined;
        while (owner === undefined && candidate.includes('.')) {
            candidate = candidate.slice(0, candidate.lastIndexOf('.'));
            if (isNodeValue(store.get(runtimePath(candidate)))) continue;
            owner = chainTo(candidate);
        }
        const last = owner?.[owner.length - 1];
        if (!owner || !last) return undefined;

        const base = runtimePath(last.path);
        const steps = path.slice(base.length + 1).split('.');
        const below: Frame[] = [];
        let current = base;
        for (const step of steps) {
            current = `${current}.${step}`;
            const value: unknown = store.get(current);
            if (!isNodeValue(value)) continue;
            below.push({ path: current, key: step, node: value as TreeNode, instances: [] });
        }
        if (below[below.length - 1]?.path !== path) return undefined;

        const slot = [...below].reverse().find((frame) => store.get(`${frame.path}.row`) !== undefined);
        return { chain: [...owner, ...below], owner, ...(slot ? { rowPath: `${slot.path}.row` } : {}) };
    }

    function fail(statePath: string, error: BuildError, reason: string): void {
        report.error(error.message, { code: error.code, state: statePath, reason });
        try {
            hooks?.onError?.(error);
        } catch (hookError) {
            report.error('onError hook failed', { code: error.code, state: statePath, reason: String(hookError) });
        }
    }

    /**
     * A component rendered through an alias in `$.app` (`$.app.list.slots.3`, which a record view links to
     * `runtimePath('$.app.list').slots.3`) reports its alias path. Runtime aliases always mirror the owner's runtime
     * path, so the runtime node is the first owner on the chain whose runtime path plus the rest of the path is a node
     */
    function runtimeTwin(path: string): string | undefined {
        const chain = chainTo(path);
        if (!chain) return undefined;
        for (const frame of chain.slice(0, -1).reverse()) {
            const candidate = `${runtimePath(frame.path)}${path.slice(frame.path.length)}`;
            if (isNodeValue(store.get(candidate))) return candidate;
        }
        return undefined;
    }

    function handle(event: Event): void {
        const raised = raisedBy(event, tags);
        if (!raised) return;
        const path = raised.path.startsWith(RUNTIME_NODES) ? raised.path : (runtimeTwin(raised.path) ?? raised.path);
        const inRuntime = path.startsWith(RUNTIME_NODES);
        const found = inRuntime ? runtimeChain(path) : undefined;
        const chain = inRuntime ? found?.chain : chainTo(path);
        if (!chain) return;
        run(event.type, event instanceof CustomEvent ? event.detail : undefined, chain, found);
    }

    /** Runs the `on` entry for `type` of the last node of `chain`, if it has one */
    function run(type: string, payload: unknown, chain: Frame[], found?: { owner: Frame[]; rowPath?: string }): void {
        const self = chain[chain.length - 1];
        if (!self) return;
        const on: unknown = self.node[RESERVED_KEYS.on];
        if (on === null || typeof on !== 'object' || Array.isArray(on) || !Object.hasOwn(on, type)) return;
        const commands = readEntry((on as Record<string, unknown>)[type]);
        if (!commands) {
            fail(
                self.path,
                buildError('SUI-RUN-ON-SHAPE', { event: type, path: self.path, statePath: self.path }),
                'the on entry is not a command or a list of commands'
            );
            return;
        }

        const context: CommandContext = {
            chain,
            relative: found?.owner ?? chain,
            ...(found?.rowPath === undefined ? {} : { rowPath: found.rowPath }),
            rootPath: rootOf(chain[0]?.path ?? rootPath) ?? rootPath,
            library,
            host,
            store,
            payload,
            emit: (name, payload) => hooks?.onEmit?.(name, payload),
            ...(options.navigate === undefined ? {} : { navigate: options.navigate })
        };
        for (const command of commands) {
            try {
                runCommand(command, context);
            } catch (error) {
                const failure = error instanceof CommandFailure ? error : undefined;
                const details = { event: type, path: self.path, statePath: self.path };
                const built =
                    failure?.target !== undefined
                        ? buildError('SUI-RUN-ON-TARGET', { ...details, target: failure.target })
                        : buildError('SUI-RUN-ON-COMMAND', { ...details, command: command.command, reason: failure ? failure.message : String(error) });
                fail(self.path, built, failure ? failure.message : String(error));
                return;
            }
        }
    }

    /** Answers `ui-file-transfer` with the host's `transferFile` hook; without one the event is left unanswered */
    function transfer(event: Event): void {
        const request: unknown = event instanceof CustomEvent ? event.detail : undefined;
        if (!isFileTransfer(request) || !hooks?.transferFile) return;
        event.stopPropagation();
        const { file, onProgress, signal } = request;
        request.respond(
            hooks.transferFile(file, {
                ...(onProgress === undefined ? {} : { onProgress }),
                ...(signal === undefined ? {} : { signal })
            })
        );
    }

    /** Answers `ui-file-read` with the host's `readFile` hook; without one the event is left unanswered */
    function read(event: Event): void {
        const request: unknown = event instanceof CustomEvent ? event.detail : undefined;
        if (!isFileRead(request) || !hooks?.readFile) return;
        event.stopPropagation();
        const { id, signal } = request;
        request.respond(hooks.readFile(id, signal === undefined ? {} : { signal }));
    }

    for (const name of names) host.addEventListener(name, handle, true);
    host.addEventListener(FILE_TRANSFER_EVENT, transfer);
    host.addEventListener(FILE_READ_EVENT, read);

    return {
        raise(name, payload): void {
            const chain = chainTo(rootPath);
            if (chain) run(name, payload, chain);
        },
        dispose(): void {
            for (const name of names) host.removeEventListener(name, handle, true);
            host.removeEventListener(FILE_TRANSFER_EVENT, transfer);
            host.removeEventListener(FILE_READ_EVENT, read);
        }
    };
}
