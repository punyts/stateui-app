import { report } from '@punyts/core';
import { buildError } from '../core/errors/index.js';
import type { BuildError } from '../core/errors/index.js';
import { isSystemCommand } from '../core/on/index.js';
import type { Frame, TreeNode } from '../core/on/index.js';
import type { ComponentLibrary } from '../core/resolve/index.js';
import { isNodeValue } from '../core/resolve/merge.js';
import type { JsonValue } from '../core/types.js';
import { CommandFailure, runCommand } from '../dom/on/commands.js';
import type { CommandContext } from '../dom/on/commands.js';

const APP_PATH = '$.app';
const EVENT = 'command';

export interface CommandRun {
    host: Element;
    store: CommandContext['store'];
    library: ComponentLibrary;
}

/**
 * Runs the command of a `command` message with the command runner the dispatcher uses for `on`: the target is the
 * state path (`$.app...`) of a node, and the component's element handles the command. Returns the error to post, or
 * undefined when it ran. The system commands `set`, `toggle` and `emit` are refused (a write goes through `write`
 * messages, and the minion's own events must not loop back to it). A target or command that does not resolve is
 * found before anything runs, so nothing changes
 */
export function runCommandMessage(run: CommandRun, target: string, command: string, value: JsonValue | undefined): BuildError | undefined {
    const root: unknown = run.store.get(APP_PATH);
    const details = { event: EVENT, path: target, statePath: target };
    if (isSystemCommand(command)) return buildError('SUI-RUN-ON-COMMAND', { ...details, command });
    if (!isNodeValue(root)) return buildError('SUI-RUN-ON-TARGET', { ...details, target });
    const frame: Frame = { path: APP_PATH, key: 'app', node: root as TreeNode, instances: [] };
    const context: CommandContext = {
        chain: [frame],
        relative: [frame],
        rootPath: APP_PATH,
        library: run.library,
        host: run.host,
        store: run.store,
        payload: undefined,
        emit: () => undefined
    };
    try {
        runCommand({ command, target, ...(value === undefined ? {} : { value }) }, context);
        return undefined;
    } catch (error) {
        const failure = error instanceof CommandFailure ? error : undefined;
        report.error('runtime command failed', { target, command, reason: failure ? failure.message : String(error) });
        return failure?.target === undefined
            ? buildError('SUI-RUN-ON-COMMAND', { ...details, command })
            : buildError('SUI-RUN-ON-TARGET', { ...details, target: failure.target });
    }
}
