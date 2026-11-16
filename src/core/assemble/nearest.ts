/** How many near names an error lists */
const MAX_NEAREST = 3;

/** The edit distance (insert, delete, replace) between two names */
function distance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min((previous[j] as number) + 1, (current[j - 1] as number) + 1, (previous[j - 1] as number) + cost);
        }
        previous = current;
    }
    return previous[b.length] as number;
}

/**
 * Up to three of `candidates` close to `name`: within an edit distance of a third of the longer name (at least 2), or
 * containing it or contained in it; nearest first, ties by name
 */
export function nearestNames(name: string, candidates: Iterable<string>): string[] {
    const wanted = name.toLowerCase();
    const scored: { name: string; score: number }[] = [];
    for (const candidate of new Set(candidates)) {
        const lower = candidate.toLowerCase();
        const score = distance(wanted, lower);
        const limit = Math.max(2, Math.floor(Math.max(wanted.length, lower.length) / 3));
        if (score <= limit || lower.includes(wanted) || wanted.includes(lower)) scored.push({ name: candidate, score });
    }
    return scored
        .sort((a, b) => a.score - b.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .slice(0, MAX_NEAREST)
        .map((entry) => entry.name);
}
