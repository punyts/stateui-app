import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import type { Link, LinkStore } from './types.js';

/** What `applyLinks` created per store, so applying twice does not notify twice */
const applied = new WeakMap<object, Map<string, string>>();

function fromPath(link: Link): string {
    return `${link.statePath}.${link.key}`;
}

function isCycle(from: string, target: string): boolean {
    return target === from || target.startsWith(`${from}.`) || from.startsWith(`${target}.`);
}

/**
 * Creates a store link for each entry (`store.link(statePath.key, target)`). A refused link is
 * `SUI-LINK-CYCLE` when the target is the property, inside it, above it or loops back through other links,
 * and `SUI-LINK-MISSING` when the target does not exist; both carry the node path. Idempotent: a link already
 * applied to the store with the same target is skipped, and one with a new target is re-pointed. Every link is
 * tried; the errors of the refused ones are returned
 */
export function applyLinks(store: LinkStore, links: readonly Link[]): BuildError[] {
    const errors: BuildError[] = [];
    const done = applied.get(store) ?? new Map<string, string>();
    applied.set(store, done);

    for (const link of links) {
        const from = fromPath(link);
        if (done.get(from) === link.target) continue;

        const options = link.allowMissing ? { allowMissing: true } : undefined;
        if (store.link(from, link.target, options)) {
            done.set(from, link.target);
            continue;
        }

        const missing = !isCycle(from, link.target) && !link.allowMissing && store.get(link.target) === undefined;
        const details = { target: link.target, path: link.statePath, statePath: link.statePath };
        errors.push(buildError(missing ? 'SUI-LINK-MISSING' : 'SUI-LINK-CYCLE', details));
    }
    return errors;
}

/** Removes the store links `applyLinks` created for these entries. Listeners stay registered; remove them with `off` */
export function disposeLinks(store: LinkStore, links: readonly Link[]): void {
    const done = applied.get(store);
    for (const link of links) {
        const from = fromPath(link);
        if (done?.has(from)) {
            store.unlink(from);
            done.delete(from);
        }
    }
}
