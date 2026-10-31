import { isObject } from '../resolve/merge.js';
import type { JsonValue } from '../types.js';
import { COMMAND_KEYS, SYSTEM_COMMANDS } from './types.js';
import type { OnCommand, ParsedTarget, SystemCommand } from './types.js';

const NAMED = /^\^([^.^$\s]+)((?:\.[^.\s]+)*)$/;
const STEP = /^[^.\s]+$/;

/** True when `command` is one of `set`, `toggle` and `emit` */
export function isSystemCommand(command: string): command is SystemCommand {
    return (SYSTEM_COMMANDS as readonly string[]).includes(command);
}

/**
 * Reads one command object: `{ command, target?, value? }`. Returns undefined when `command` is not a
 * non-empty string, when `target` is present and not a non-empty string, or when another key is present
 */
export function readCommand(value: unknown): OnCommand | undefined {
    if (!isObject(value)) return undefined;
    if (Object.keys(value).some((key) => !(COMMAND_KEYS as readonly string[]).includes(key))) return undefined;
    const { command, target } = value;
    if (typeof command !== 'string' || command === '') return undefined;
    if (target !== undefined && (typeof target !== 'string' || target === '')) return undefined;

    const result: OnCommand = { command };
    if (target !== undefined) result.target = target;
    if (Object.hasOwn(value, 'value')) result.value = value['value'] as JsonValue;
    return result;
}

/**
 * Reads an `on` entry: one command object, or a non-empty ordered list of them. Returns undefined when the entry or
 * any item is not a command object
 */
export function readEntry(value: unknown): OnCommand[] | undefined {
    if (!Array.isArray(value)) {
        const single = readCommand(value);
        return single ? [single] : undefined;
    }
    if (value.length === 0) return undefined;
    const commands: OnCommand[] = [];
    for (const item of value) {
        const command = readCommand(item);
        if (!command) return undefined;
        commands.push(command);
    }
    return commands;
}

/**
 * Reads a target text: `^name.path` (named ancestor), `.path` (own subtree), `$parent`, `$row` and `$row.path` (the
 * record of a row template) and `$.path` (absolute).
 * Dot climbing (`..x`), empty steps and any other form return undefined
 */
export function parseTarget(text: string): ParsedTarget | undefined {
    if (text === '$parent') return { form: 'parent' };
    if (text === '$row') return { form: 'row', segments: [] };
    if (text.startsWith('$row.')) {
        const segments = text.slice(5).split('.');
        return segments.every((step) => STEP.test(step)) ? { form: 'row', segments } : undefined;
    }

    if (text.startsWith('$.')) {
        const segments = text.slice(2).split('.');
        return segments.every((step) => STEP.test(step)) ? { form: 'absolute', segments } : undefined;
    }

    if (text.startsWith('^')) {
        const match = NAMED.exec(text);
        if (!match) return undefined;
        const name = match[1] as string;
        const rest = match[2] as string;
        return { form: 'named', name, segments: rest === '' ? [] : rest.slice(1).split('.') };
    }

    if (text.startsWith('.')) {
        const segments = text.slice(1).split('.');
        return segments.every((step) => STEP.test(step)) ? { form: 'own', segments } : undefined;
    }

    return undefined;
}
