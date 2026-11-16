import { pathSteps } from './pattern.js';
import type { PathPattern } from './pattern.js';

interface IndexNode<T> {
    readonly literal: Map<string, IndexNode<T>>;
    /** The branch of `*` and `{name}` steps, which fit any key */
    wild?: IndexNode<T>;
    /** The items whose pattern ends at this node */
    readonly here: T[];
}

function node<T>(): IndexNode<T> {
    return { literal: new Map(), here: [] };
}

/**
 * The trigger patterns of a logic document as a tree keyed by path step, so a change finds the patterns that can
 * match it in one walk instead of being tried against every pattern. A pattern matches a change at, below or above it
 * (see `matchPattern`), so `find` returns the items of every pattern along the change's path (the change is at or
 * below them) and of every pattern under the change's last step (the change is above them). The answer can include
 * patterns that do not match after all only when the value expands differently; `matchPattern` still decides
 */
export class PathIndex<T> {
    private readonly root: IndexNode<T> = node();

    add(pattern: PathPattern, item: T): void {
        let current = this.root;
        for (const step of pattern.steps) {
            if (step.kind === 'literal') {
                let next = current.literal.get(step.text);
                if (!next) {
                    next = node();
                    current.literal.set(step.text, next);
                }
                current = next;
            } else {
                current.wild ??= node();
                current = current.wild;
            }
        }
        current.here.push(item);
    }

    /** The items whose patterns can match a change at `path` */
    find(path: string, into: Set<T> = new Set()): Set<T> {
        const steps = pathSteps(path);
        const collect = (at: IndexNode<T>): void => {
            for (const item of at.here) into.add(item);
            for (const child of at.literal.values()) collect(child);
            if (at.wild) collect(at.wild);
        };
        const walk = (at: IndexNode<T>, depth: number): void => {
            if (depth === steps.length) {
                collect(at);
                return;
            }
            for (const item of at.here) into.add(item);
            const literal = at.literal.get(steps[depth] as string);
            if (literal) walk(literal, depth + 1);
            if (at.wild) walk(at.wild, depth + 1);
        };
        walk(this.root, 0);
        return into;
    }
}
