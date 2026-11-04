import type { JsonValue } from '../types.js';

/** The commands the runtime provides itself; every other command belongs to a root component's shape */
export const SYSTEM_COMMANDS = ['set', 'toggle', 'emit'] as const;

export type SystemCommand = (typeof SYSTEM_COMMANDS)[number];

/** The keys a command object may hold */
export const COMMAND_KEYS = ['command', 'target', 'value', 'from'] as const;

/**
 * One command object of an `on` entry. `target` names where the command acts (for `emit` it is the event name);
 * `value` is the command's argument: what `set` writes, the key `select` takes, the payload `emit` sends.
 * When `value` is absent, `emit` sends the event's own payload. `from` takes the place of `value`: a path in any target
 * form (`$.data.x`, `^name.path`, `.path`, `$row.path`) whose current value is the argument, so `set` copies a value
 */
export interface OnCommand {
    command: string;
    target?: string;
    value?: JsonValue;
    from?: string;
}

/** An event's entry: one command object or an ordered list of them */
export type OnEntry = OnCommand | OnCommand[];

/** A target that has been read from its text. `segments` are the path steps below the anchor */
export type ParsedTarget =
    | { form: 'named'; name: string; segments: string[] }
    | { form: 'own'; segments: string[] }
    | { form: 'parent' }
    /** `$row` or `$row.path`: the record a row template's slot shows */
    | { form: 'row'; segments: string[] }
    | { form: 'absolute'; segments: string[] };

/** A resolved node */
export type TreeNode = { component: string; [key: string]: JsonValue };

/** A node on the way from the validated root down to the node that holds an `on` entry */
export interface Frame {
    /** The node's state path, such as `$.app.children.save` */
    path: string;
    /** The last step of `path`: the child key, the slot name or `app` */
    key: string;
    /** The resolved node */
    node: TreeNode;
    /** The composed component names expanded at this path, outermost first (`ResolveResult.instances`) */
    instances: readonly string[];
}

/** What a target points at */
export type Located =
    /** A node of the tree */
    | { kind: 'node'; path: string; node: TreeNode }
    /** A property of a node: the node's path, the node and the property name */
    | { kind: 'property'; path: string; node: TreeNode; property: string; rest: string[] }
    /** A path outside `$.app` (`$.data...`, `$.theme...`): there is no node to check */
    | { kind: 'state'; path: string }
    /** A path under `$.app` but outside the validated subtree, which cannot be checked here */
    | { kind: 'outside'; path: string };
