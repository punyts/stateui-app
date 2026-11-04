import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { isObject } from '../resolve/merge.js';
import type { ComponentLibrary, ResolveResult } from '../resolve/index.js';
import { nodeChildren } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import { RESERVED_KEYS, isAppEvent } from '../types.js';
import type { JsonValue } from '../types.js';
import { parseTarget, readCommand, readEntry } from './parse.js';
import { findProvider, findRowProvider, resolveTarget } from './resolveTarget.js';
import type { Frame, Located, OnCommand, TreeNode } from './types.js';

const ROOT_PATH = '$.app';

export interface ValidateOnOptions {
    /** The state path of the node being validated; `$.app` when absent */
    path?: string;
}

/** The part of a `ResolveResult` the validator needs */
export type ResolvedTree = Pick<ResolveResult, 'node' | 'instances'>;

function shapeOf(library: ComponentLibrary, component: string): Shape | undefined {
    if (!Object.hasOwn(library, component)) return undefined;
    const entry = library[component];
    return entry?.tier === 'root' ? entry.shape : undefined;
}

/** The chain of the node holding an `on` entry and, inside a row template, the index of the owning frame */
interface Scope {
    chain: readonly Frame[];
    owner: number | undefined;
}

/** What stands for the slot's `row` alias while validating: the alias only exists at run time */
const ROW_MARKER = '$row';

/** The frames `^name.path` and `.path` resolve against: the whole chain, or only up to the owner inside a row template */
function relativeChain(scope: Scope): readonly Frame[] {
    return scope.owner === undefined ? scope.chain : scope.chain.slice(0, scope.owner + 1);
}

/** One check run over a tree whose nodes name root components */
class OnValidator {
    readonly errors: BuildError[] = [];

    constructor(
        private readonly library: ComponentLibrary,
        private readonly instances: Readonly<Record<string, string[]>>,
        private readonly rootPath: string
    ) {}

    /** `owner` is the index in the chain of the node that owns the row template this node is inside, if any */
    visit(node: TreeNode, path: string, parents: readonly Frame[], owner?: number): void {
        const frame: Frame = {
            path,
            key: path.slice(path.lastIndexOf('.') + 1),
            node,
            instances: Object.hasOwn(this.instances, path) ? (this.instances[path] as string[]) : []
        };
        const chain = [...parents, frame];

        if (Object.hasOwn(node, RESERVED_KEYS.on)) this.checkOn(node[RESERVED_KEYS.on] as JsonValue, chain, owner);

        for (const child of nodeChildren(node, path, shapeOf(this.library, node.component))) {
            this.visit(child.node as TreeNode, child.path, chain, child.row ? chain.length - 1 : owner);
        }
    }

    /** An `on` map, entry or list item that is not a command object or a list of them */
    private malformed(statePath: string): void {
        this.errors.push(buildError('SUI-ON-SHAPE', { path: statePath, statePath }));
    }

    private badTarget(target: string, event: string, chain: readonly Frame[], statePath: string): void {
        const self = chain[chain.length - 1] as Frame;
        this.errors.push(buildError('SUI-ON-TARGET', { target, event, path: self.path, statePath }));
    }

    private checkOn(on: JsonValue, chain: readonly Frame[], owner: number | undefined): void {
        const self = chain[chain.length - 1] as Frame;
        const onPath = `${self.path}.${RESERVED_KEYS.on}`;
        if (!isObject(on)) {
            this.malformed(onPath);
            return;
        }

        const shape = shapeOf(this.library, self.node.component);
        for (const [event, entry] of Object.entries(on)) {
            const eventPath = `${onPath}.${event}`;
            const appEvent = self.path === '$.app' && isAppEvent(event);
            if (shape && !appEvent && !shape.events.includes(event)) {
                this.errors.push(
                    buildError('SUI-ON-EVENT', { component: self.node.component, path: self.path, event, statePath: eventPath })
                );
            }

            if (!readEntry(entry)) {
                this.reportMalformed(entry, eventPath);
                continue;
            }
            const list = Array.isArray(entry);
            const items: JsonValue[] = Array.isArray(entry) ? entry : [entry];
            items.forEach((item, index) => {
                const itemPath = list ? `${eventPath}.${index}` : eventPath;
                this.checkCommand(readCommand(item) as OnCommand, event, { chain, owner }, itemPath);
            });
        }
    }

    /** Points at each list item that is wrong, or at the entry itself */
    private reportMalformed(entry: JsonValue, eventPath: string): void {
        if (!Array.isArray(entry) || entry.length === 0) {
            this.malformed(eventPath);
            return;
        }
        entry.forEach((item, index) => {
            if (!readCommand(item)) this.malformed(`${eventPath}.${index}`);
        });
    }

    private checkCommand(command: OnCommand, event: string, scope: Scope, statePath: string): void {
        if (command.from !== undefined) this.checkFrom(command.from, event, scope, statePath);
        if (command.command === 'emit') {
            if (command.target === undefined) this.malformed(statePath);
            return;
        }
        if (command.command === 'set' || command.command === 'toggle') {
            this.checkWrite(command, event, scope, statePath);
            return;
        }
        this.checkComponentCommand(command, event, scope, statePath);
    }

    /** `set` and `toggle` write to a property: they need a target that names one, and `set` needs a value */
    private checkWrite(command: OnCommand, event: string, scope: Scope, statePath: string): void {
        const { chain } = scope;
        if (command.command === 'set' && !('value' in command) && command.from === undefined) this.malformed(statePath);
        if (command.target === undefined) {
            this.malformed(statePath);
            return;
        }

        const located = this.locate(command.target, scope);
        const ok =
            located !== undefined &&
            (located.kind === 'state' ||
                located.kind === 'outside' ||
                (located.kind === 'property' && this.declares(located.node.component, located.property)));
        if (!ok) this.badTarget(command.target, event, chain, statePath);
    }

    /** `from` reads a value: a property a component declares, a path outside `$.app` or `$row.path`, never a node */
    private checkFrom(from: string, event: string, scope: Scope, statePath: string): void {
        const located = this.locate(from, scope);
        const ok =
            located !== undefined &&
            (located.kind === 'state' ||
                located.kind === 'outside' ||
                (located.kind === 'property' && this.declares(located.node.component, located.property)));
        if (!ok) this.badTarget(from, event, scope.chain, statePath);
    }

    private checkComponentCommand(command: OnCommand, event: string, scope: Scope, statePath: string): void {
        const { chain } = scope;
        const name = command.command;
        if (command.target !== undefined && parseTarget(command.target)?.form === 'row') {
            const declares = (frame: Frame): boolean => this.commandsOf(frame.node.component)?.includes(name) === true;
            const provider = scope.owner === undefined ? undefined : findRowProvider(relativeChain(scope), declares);
            if (!provider || command.target !== '$row') this.badTarget(command.target, event, chain, statePath);
            return;
        }
        if (command.target === '$parent') {
            const provider = findProvider(chain, (frame) => this.commandsOf(frame.node.component)?.includes(name) === true);
            if (!provider) this.badTarget(command.target, event, chain, statePath);
            return;
        }

        const self = chain[chain.length - 1] as Frame;
        const located: Located | undefined =
            command.target === undefined
                ? { kind: 'node', path: self.path, node: self.node }
                : this.locate(command.target, scope);
        if (!located || located.kind === 'state' || located.kind === 'property') {
            this.badTarget(command.target ?? '', event, chain, statePath);
            return;
        }
        if (located.kind === 'outside') return;

        const commands = this.commandsOf(located.node.component);
        if (commands && !commands.includes(name)) {
            this.errors.push(
                buildError('SUI-ON-COMMAND', { component: located.node.component, path: located.path, command: name, statePath })
            );
            return;
        }
        this.checkValue(command, located.node, statePath);
    }

    /**
     * A literal `value` of a command the shape lists in `commandValues` must be a key of that map property, read from
     * the node or the shape default. A `$` path or a `{{ }}` expression is only known at run time and is not checked
     */
    private checkValue(command: OnCommand, node: TreeNode, statePath: string): void {
        const shape = shapeOf(this.library, node.component);
        const property = shape?.commandValues?.[command.command];
        const value = command.value;
        if (property === undefined || typeof value !== 'string' || value.startsWith('$') || value.includes('{{')) return;

        const map = Object.hasOwn(node, property) ? node[property] : shape?.properties[property]?.default;
        if (isObject(map) && !Object.hasOwn(map, value)) {
            this.errors.push(buildError('SUI-ON-VALUE', { command: command.command, path: statePath, name: property, statePath }));
        }
    }

    /** Relative targets inside a row template resolve against the owner's chain; `$row` is legal there only */
    private locate(text: string, scope: Scope): Located | undefined {
        const parsed = parseTarget(text);
        return parsed
            ? resolveTarget(parsed, relativeChain(scope), this.rootPath, scope.owner === undefined ? undefined : ROW_MARKER)
            : undefined;
    }

    private commandsOf(component: string): readonly string[] | undefined {
        return shapeOf(this.library, component)?.commands;
    }

    /** A component without a shape (unknown) cannot be checked, so every property is accepted */
    private declares(component: string, property: string): boolean {
        const shape = shapeOf(this.library, component);
        return shape === undefined || Object.hasOwn(shape.properties, property);
    }
}

/**
 * Checks every `on` entry in a resolved tree and returns the errors, in tree order:
 * - a malformed `on` (reported as `SUI-DOC-SHAPE` with the state path until the catalog has a `SUI-ON` code for it):
 *   not a map of event to entry, an entry that is not one command object or a non-empty list of them, a command
 *   object with other keys or with both `value` and `from`, an `emit` without a target (its event name), a `set`
 *   without a value or `from`, or a `set` or
 *   `toggle` without a target
 * - `SUI-ON-EVENT`: the node's component does not declare the event; the root node (`$.app`) may also use the app
 *   events (`APP_EVENTS`: `sync.rejected`, `logic.failed`, and `notify.<name>`) the host raises
 * - `SUI-ON-COMMAND`: the target's component does not declare the command
 * - `SUI-ON-VALUE`: a literal `value` of a command the target's shape lists in `commandValues` is not a key of that map
 * - `SUI-ON-TARGET`: the target text is not a valid form (including dot climbing), the ancestor or a step does not
 *   exist, no ancestor provides the command for `$parent`, a component command targets a property or a path outside
 *   `$.app`, `set` and `toggle` do not target a property the component declares, or `from` names no such property,
 *   path or `$row.path`
 *
 * Target rules: a component command without a target acts on the node itself; `set` and `toggle` target a property
 * (`$.data.name`, `.value`, `^form.children.name.value`); `emit` uses `target` as the event name and is not resolved.
 * A node of an unknown component is skipped for event, command and property checks. Pure; never throws.
 * `tree` is the result of `resolveNode`
 */
export function validateOn(tree: ResolvedTree, library: ComponentLibrary, options: ValidateOnOptions = {}): BuildError[] {
    const rootPath = options.path ?? ROOT_PATH;
    const validator = new OnValidator(library, tree.instances, rootPath);
    validator.visit(tree.node, rootPath, []);
    return validator.errors;
}
