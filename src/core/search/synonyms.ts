import { stem } from './tokenize.js';

/**
 * The reviewed synonym groups. A need word is expanded to every member of its group, and a member found in a component
 * counts as a match of the need word. Members are plain words; they are stemmed like everything else. Add a group
 * only when the words name the same need in a UI request (a test checks every ordered pair of every group)
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = Object.freeze([
    Object.freeze(['pick', 'choose', 'select']),
    Object.freeze(['sum', 'total']),
    Object.freeze(['show', 'display']),
    Object.freeze(['remove', 'delete']),
    Object.freeze(['change', 'edit', 'update']),
    Object.freeze(['login', 'sign', 'signin']),
    Object.freeze(['money', 'price', 'cost']),
    Object.freeze(['picture', 'photo', 'image'])
]);

/** The stems a need term matches: itself and the stems of every group it is in */
export type SynonymExpander = (term: string) => ReadonlySet<string>;

/** Builds the expander of a table; a term in no group expands to itself */
export function synonymExpander(groups: readonly (readonly string[])[] = SYNONYM_GROUPS): SynonymExpander {
    const byStem = new Map<string, Set<string>>();
    for (const group of groups) {
        const stems = group.map((word) => stem(word.toLowerCase()));
        for (const member of stems) {
            const set = byStem.get(member) ?? new Set<string>([member]);
            for (const other of stems) set.add(other);
            byStem.set(member, set);
        }
    }
    return (term) => byStem.get(term) ?? new Set([term]);
}
