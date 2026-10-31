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
import type { Dispatcher, DispatcherOptions } from './types.js';

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

/** The tags of the library's root components */
function tags(library: ComponentLibrary): Set<string> {
    const result = new Set<string>();
    for (const entry of Object.values(library)) if (entry.tier === 'root') result.add(entry.tag);
    return result;
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
    const instances = options.instances ?? {};
    const componentTags = tags(library);
    const names = eventNames(library);

    /** Frames from the root down to `path`; undefined when `path` is not a node below the root */
    function chainTo(path: string): Frame[] | undefined {
        if (path !== rootPath && !path.startsWith(`${rootPath}.`)) return undefined;
        const steps = path === rootPath ? [] : path.slice(rootPath.length + 1).split('.');
        const chain: Frame[] = [];
        let current = rootPath;
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
     * `owner` is the owner's chain; `rowPath` is the `row` alias of the nearest slot at or above the node
     */
    function runtimeChain(path: string): { chain: Frame[]; owner: Frame[]; rowPath?: string } | undefined {
        let candidate = `$.${path.slice(RUNTIME_NODES.length)}`;
        let owner: Frame[] | undefined;
        while (owner === undefined && candidate.includes('.')) {
            candidate = candidate.slice(0, candidate.lastIndexOf('.'));
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

    function handle(event: Event): void {
        const raised = raisedBy(event, componentTags);
        if (!raised) return;
        const inRuntime = raised.path.startsWith(RUNTIME_NODES);
        const found = inRuntime ? runtimeChain(raised.path) : undefined;
        const chain = inRuntime ? found?.chain : chainTo(raised.path);
        const self = chain?.[chain.length - 1];
        if (!chain || !self) return;

        const on: unknown = self.node[RESERVED_KEYS.on];
        if (on === null || typeof on !== 'object' || Array.isArray(on) || !Object.hasOwn(on, event.type)) return;
        const commands = readEntry((on as Record<string, unknown>)[event.type]);
        if (!commands) {
            fail(
                self.path,
                buildError('SUI-RUN-ON-SHAPE', { event: event.type, path: self.path, statePath: self.path }),
                'the on entry is not a command or a list of commands'
            );
            return;
        }

        const context: CommandContext = {
            chain,
            relative: found?.owner ?? chain,
            ...(found?.rowPath === undefined ? {} : { rowPath: found.rowPath }),
            rootPath,
            library,
            host,
            store,
            payload: event instanceof CustomEvent ? event.detail : undefined,
            emit: (name, payload) => hooks?.onEmit?.(name, payload)
        };
        for (const command of commands) {
            try {
                runCommand(command, context);
            } catch (error) {
                const failure = error instanceof CommandFailure ? error : undefined;
                const details = { event: event.type, path: self.path, statePath: self.path };
                const built =
                    failure?.target !== undefined
                        ? buildError('SUI-RUN-ON-TARGET', { ...details, target: failure.target })
                        : buildError('SUI-RUN-ON-COMMAND', { ...details, command: command.command });
                fail(self.path, built, failure ? failure.message : String(error));
                return;
            }
        }
    }

    for (const name of names) host.addEventListener(name, handle, true);

    return {
        dispose(): void {
            for (const name of names) host.removeEventListener(name, handle, true);
        }
    };
}
