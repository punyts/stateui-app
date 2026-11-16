import { report } from '@punyts/core';
import { buildError } from '../core/errors/index.js';
import type { BuildError } from '../core/errors/index.js';
import { isSystemCommand } from '../core/on/index.js';
import type { Frame, TreeNode } from '../core/on/index.js';
import type { ComponentLibrary } from '../core/resolve/index.js';
import { NAVIGATE_COMMAND } from '../core/route/index.js';
import { isNodeValue } from '../core/resolve/merge.js';
import type { JsonValue } from '../core/types.js';
import { CommandFailure, runCommand } from '../dom/on/commands.js';
import type { CommandContext } from '../dom/on/commands.js';

const APP_PATH = '$.app';
const SCREENS = '$.screens.';

/** The root a target is below: its screen's `$.screens.{name}`, else `$.app` */
function rootOf(target: string): string {
    if (!target.startsWith(SCREENS)) return APP_PATH;
    const name = target.slice(SCREENS.length).split('.')[0] as string;
    return `${SCREENS}${name}`;
}
const EVENT = 'command';

export interface CommandRun {
    host: Element;
    store: CommandContext['store'];
    library: ComponentLibrary;
    /** Runs `navigate` (`MountedApp.navigate`): the reason it cannot, undefined when it moved */
    navigate?(screen: string, params: JsonValue | undefined): string | undefined;
}

/**
 * Runs the command of a `command` message with the command runner the dispatcher uses for `on`: the target is the
 * state path (`$.app...`, or `$.screens.{name}...` for a node of a screen) of a node, and the component's element
 * handles the command. Returns the error to post, or
 * undefined when it ran. `navigate` takes a screen name as its target and the params as its value, and moves
 * `$.route` as the `on` command does. The other system commands `set`, `toggle` and `emit` are refused (a write
 * goes through `write` messages, and the minion's own events must not loop back to it). A target or command that does
 * not resolve is found before anything runs, so nothing changes
 */
export function runCommandMessage(run: CommandRun, target: string, command: string, value: JsonValue | undefined): BuildError | undefined {
    const rootPath = rootOf(target);
    const root: unknown = run.store.get(rootPath);
    const details = { event: EVENT, path: target, statePath: target };
    if (command === NAVIGATE_COMMAND) {
        const reason = run.navigate === undefined ? `the app has no screens, so it cannot navigate to "${target}"` : run.navigate(target, value);
        return reason === undefined ? undefined : buildError('SUI-RUN-ON-COMMAND', { ...details, command, reason });
    }
    if (isSystemCommand(command)) return buildError('SUI-RUN-ON-COMMAND', { ...details, command, reason: `${command} runs only in an on entry, not as a component command` });
    if (!isNodeValue(root)) return buildError('SUI-RUN-ON-TARGET', { ...details, target });
    const frame: Frame = { path: rootPath, key: rootPath.slice(rootPath.lastIndexOf('.') + 1), node: root as TreeNode, instances: [] };
    const context: CommandContext = {
        chain: [frame],
        relative: [frame],
        rootPath,
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
            ? buildError('SUI-RUN-ON-COMMAND', { ...details, command, reason: failure ? failure.message : String(error) })
            : buildError('SUI-RUN-ON-TARGET', { ...details, target: failure.target });
    }
}
