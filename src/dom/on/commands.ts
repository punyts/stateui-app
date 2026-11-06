import type { Frame, Located, OnCommand, TreeNode } from '../../core/on/index.js';
import { findProvider, findRowProvider, parseTarget, resolveTarget } from '../../core/on/index.js';
import { cloneJson } from '../../core/resolve/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import type { Shape } from '../../core/shape/index.js';
import type { JsonValue } from '../../core/types.js';
import type { CommandElement } from './types.js';

/**
 * A command that cannot run: the dispatcher reports `SUI-RUN` for the node and stops the list. `target` is set when
 * the failure is a target that does not resolve
 */
export class CommandFailure extends Error {
    constructor(
        message: string,
        readonly target?: string
    ) {
        super(message);
    }
}

/** What a command needs to run */
export interface CommandContext {
    chain: readonly Frame[];
    /**
     * The frames `^name.path` and `.path` resolve against: the chain itself, or inside a row template only the
     * frames down to the node that owns the template (the slot's own nodes live in the runtime branch)
     */
    relative: readonly Frame[];
    /** The path of the `row` alias of the slot the node sits in; absent outside a row template */
    rowPath?: string;
    rootPath: string;
    library: ComponentLibrary;
    host: Element;
    store: { get(path: string): unknown; set(path: string, value: never): boolean };
    payload: unknown;
    emit(name: string, payload: unknown): void;
    /** Moves `$.route` to a screen; returns why it cannot. Absent in an app without screens */
    navigate?(screen: string, params: JsonValue | undefined): string | undefined;
}

function shapeOf(library: ComponentLibrary, component: string): Shape | undefined {
    if (!Object.hasOwn(library, component)) return undefined;
    const entry = library[component];
    return entry?.tier === 'root' ? entry.shape : undefined;
}

/** The root that holds an absolute node path: `$.screens.{name}` for a screen's nodes, else `$.app` */
function holdingRoot(path: string): string {
    const SCREENS = '$.screens.';
    return path.startsWith(SCREENS) ? `${SCREENS}${path.slice(SCREENS.length).split('.')[0] as string}` : '$.app';
}

/**
 * Resolves a target against the node's own root; a path under another root (a screen naming `$.app.toasts`, or the
 * app naming a screen's node) is resolved from the root that holds it, read from the store, as validation accepts it
 */
function locate(text: string, context: CommandContext): Located | undefined {
    const parsed = parseTarget(text);
    if (!parsed) return undefined;
    const located = resolveTarget(parsed, context.relative, context.rootPath, context.rowPath);
    if (located?.kind !== 'outside') return located;
    const rootPath = holdingRoot(located.path);
    const node: unknown = context.store.get(rootPath);
    if (rootPath === context.rootPath || typeof node !== 'object' || node === null || typeof (node as TreeNode).component !== 'string') return located;
    const frame: Frame = { path: rootPath, key: rootPath.slice(rootPath.lastIndexOf('.') + 1), node: node as TreeNode, instances: [] };
    return resolveTarget(parsed, [frame], rootPath);
}

function isRowValue(value: JsonValue | undefined): value is string {
    return typeof value === 'string' && (value === '$row' || value.startsWith('$row.'));
}

/**
 * A command's argument: the value at `from` when it is set, else `value`, where `$row` and `$row.path` are read from
 * the record the slot shows and anything else is as written
 */
function valueOf(command: OnCommand, context: CommandContext): JsonValue | undefined {
    if (command.from !== undefined) {
        const located = locate(command.from, context);
        if (!located || located.kind === 'node') throw new CommandFailure(`from ${command.from} is not a value`, command.from);
        const path = located.kind === 'property' ? [located.path, located.property, ...located.rest].join('.') : located.path;
        const read: unknown = context.store.get(path);
        return read === undefined ? undefined : cloneJson(read as JsonValue);
    }
    const value = command.value;
    if (!isRowValue(value)) return value;
    if (context.rowPath === undefined) throw new CommandFailure(`${value} is used outside a row template`);
    const read: unknown = context.store.get(`${context.rowPath}${value.slice('$row'.length)}`);
    return read as JsonValue | undefined;
}

/** `navigate` params: `$row` and `$row.path` values read from the record the slot shows, at any depth */
function withRows(value: JsonValue | undefined, context: CommandContext): JsonValue | undefined {
    if (isRowValue(value)) {
        if (context.rowPath === undefined) throw new CommandFailure(`${value} is used outside a row template`);
        const read: unknown = context.store.get(`${context.rowPath}${value.slice('$row'.length)}`);
        return read === undefined ? undefined : cloneJson(read as JsonValue);
    }
    if (Array.isArray(value)) return value.map((item) => withRows(item, context) ?? null);
    if (value === null || typeof value !== 'object') return value;
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
        const read = withRows(item, context);
        if (read !== undefined) result[key] = read;
    }
    return result;
}

/** The state path a `set` or `toggle` target writes to; throws when the target names no writable property */
function writePath(command: OnCommand, context: CommandContext): string {
    const located = command.target === undefined ? undefined : locate(command.target, context);
    if (!located || located.kind === 'node') throw new CommandFailure(`target ${command.target ?? ''} is not a property`, command.target ?? '');
    if (located.kind !== 'property') return located.path;
    const shape = shapeOf(context.library, located.node.component);
    if (!shape || !Object.hasOwn(shape.properties, located.property)) {
        throw new CommandFailure(
            `target ${command.target ?? ''} is not a property of ${located.node.component}`,
            command.target ?? ''
        );
    }
    return `${located.path}.${located.property}`;
}

function write(path: string, value: JsonValue, context: CommandContext): void {
    const copy = value !== null && typeof value === 'object' ? cloneJson(value) : value;
    if (!context.store.set(path, copy as never)) throw new CommandFailure(`the store refused the write to ${path}`);
}

/**
 * The node a component command acts on: itself, the nearest provider (`$parent`), the node that owns the row
 * template (`$row`) or the node the target names
 */
function commandTarget(command: OnCommand, context: CommandContext): { path: string; node: TreeNode } {
    const self = context.chain[context.chain.length - 1] as Frame;
    if (command.target === undefined) return self;
    if (command.target === '$row') {
        const provider =
            context.rowPath === undefined
                ? undefined
                : findRowProvider(
                      context.relative,
                      (frame) => shapeOf(context.library, frame.node.component)?.commands.includes(command.command) === true
                  );
        if (!provider) throw new CommandFailure(`no node of the row template's owner provides ${command.command}`, '$row');
        return provider;
    }
    if (command.target === '$parent') {
        const provider = findProvider(
            context.chain,
            (frame) => shapeOf(context.library, frame.node.component)?.commands.includes(command.command) === true
        );
        if (!provider) throw new CommandFailure(`no ancestor provides ${command.command}`, '$parent');
        return provider;
    }
    const located = locate(command.target, context);
    if (located?.kind !== 'node') throw new CommandFailure(`target ${command.target} is not a node`, command.target);
    return located;
}

/** The elements a root component rendered for the node at `path`, searching open shadow roots too */
function findElements(root: ParentNode, tag: string, path: string, found: CommandElement[] = []): CommandElement[] {
    for (const element of Array.from(root.querySelectorAll('*'))) {
        const scope = (element as { scope?: { basePath?: string } }).scope;
        if (element.localName === tag && scope?.basePath === path) found.push(element);
        if (element.shadowRoot) findElements(element.shadowRoot, tag, path, found);
    }
    return found;
}

function runComponentCommand(command: OnCommand, context: CommandContext): void {
    const { path, node } = commandTarget(command, context);
    const entry = Object.hasOwn(context.library, node.component) ? context.library[node.component] : undefined;
    if (entry?.tier !== 'root' || !entry.shape.commands.includes(command.command)) {
        throw new CommandFailure(`${node.component} does not declare ${command.command}`);
    }

    const element = findElements(context.host, entry.tag, path).find(
        (candidate) => candidate.commands !== undefined && Object.hasOwn(candidate.commands, command.command)
    );
    const handler = element?.commands?.[command.command];
    if (typeof handler !== 'function') throw new CommandFailure(`no element at ${path} handles ${command.command}`);
    const row = command.target === '$row' ? context.rowPath : undefined;
    const value = valueOf(command, context);
    if (row === undefined) handler.call(element?.commands, value, context.payload);
    else handler.call(element?.commands, value, context.payload, row);
}

/** Runs one command; throws when it fails */
export function runCommand(command: OnCommand, context: CommandContext): void {
    if (command.command === 'set') {
        if (!('value' in command) && command.from === undefined) throw new CommandFailure('set needs a value or from');
        const value = valueOf(command, context);
        if (value === undefined && command.from !== undefined) throw new CommandFailure(`from ${command.from} has no value`, command.from);
        write(writePath(command, context), value as JsonValue, context);
    } else if (command.command === 'toggle') {
        const path = writePath(command, context);
        const current = context.store.get(path);
        if (current !== undefined && current !== null && typeof current !== 'boolean') {
            throw new CommandFailure(`${path} holds ${JSON.stringify(current)}, not a boolean`);
        }
        write(path, current !== true, context);
    } else if (command.command === 'emit') {
        if (command.target === undefined) throw new CommandFailure('emit needs an event name');
        context.emit(command.target, 'value' in command || command.from !== undefined ? valueOf(command, context) : context.payload);
    } else if (command.command === 'navigate') {
        if (command.target === undefined) throw new CommandFailure('navigate needs a screen name');
        if (context.navigate === undefined) throw new CommandFailure(`the app has no screens, so it cannot navigate to "${command.target}"`);
        const params = command.from !== undefined ? valueOf(command, context) : withRows(command.value, context);
        const reason = context.navigate(command.target, params);
        if (reason !== undefined) throw new CommandFailure(reason);
    } else {
        runComponentCommand(command, context);
    }
}
