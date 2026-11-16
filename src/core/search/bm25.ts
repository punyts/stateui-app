import { synonymExpander } from './synonyms.js';
import type { SynonymExpander } from './synonyms.js';
import { tokenize, words } from './tokenize.js';

/** The texts of one searchable entry, in four weighted lists */
export interface SearchFields {
    /** Purpose phrases, such as "pick a start and end date" (weight 3) */
    readonly purposes: readonly string[];
    /** The entry's name; camelCase is split (weight 2) */
    readonly name: readonly string[];
    /** The one-line summary (weight 1) */
    readonly summary: readonly string[];
    /** Property and event names (weight 0.5) */
    readonly properties: readonly string[];
}

export interface SearchEntry {
    readonly id: string;
    readonly fields: SearchFields;
}

export interface SearchHit {
    readonly id: string;
    readonly score: number;
    /** The purpose phrases, verbatim, that hold a matched word; then the need words matched only in other fields */
    readonly matched: readonly string[];
}

export interface SearchOptions {
    /** The synonym groups; default `SYNONYM_GROUPS` */
    readonly synonyms?: readonly (readonly string[])[];
}

/** An index built once from its entries and queried any number of times */
export interface SearchIndex {
    readonly size: number;
    /** The entries that match the need, best first; empty for an empty need or no match. `limit` cuts the list */
    search(need: string, limit?: number): readonly SearchHit[];
}

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

type FieldName = keyof SearchFields;

export const FIELD_WEIGHTS: Readonly<Record<FieldName, number>> = Object.freeze({ purposes: 3, name: 2, summary: 1, properties: 0.5 });

const FIELDS = Object.keys(FIELD_WEIGHTS) as FieldName[];

interface IndexedEntry {
    readonly id: string;
    /** Term counts per field */
    readonly counts: Readonly<Record<FieldName, ReadonlyMap<string, number>>>;
    readonly lengths: Readonly<Record<FieldName, number>>;
    /** Each purpose phrase with its terms, for `matched` */
    readonly purposes: readonly { readonly phrase: string; readonly terms: ReadonlySet<string> }[];
}

function countTerms(texts: readonly string[]): { counts: Map<string, number>; length: number } {
    const counts = new Map<string, number>();
    let length = 0;
    for (const text of texts) {
        for (const term of tokenize(text)) {
            counts.set(term, (counts.get(term) ?? 0) + 1);
            length += 1;
        }
    }
    return { counts, length };
}

/** The need's distinct terms, each with the first need word it came from */
function needTerms(need: string): Map<string, string> {
    const terms = new Map<string, string>();
    for (const word of words(need)) {
        const [term] = tokenize(word);
        if (term !== undefined && !terms.has(term)) terms.set(term, word);
    }
    return terms;
}

/**
 * BM25 over weighted fields (BM25F): per term, the field frequencies are length-normalised per field (b), weighted
 * (`FIELD_WEIGHTS`) and summed, then saturated once (k1) and multiplied by the term's idf over whole entries. A need
 * word scores through the best of its synonym stems, so a synonym never adds to its own word. Ties are broken by the
 * number of distinct need words matched, then by id
 */
export function createSearchIndex(entries: readonly SearchEntry[], options: SearchOptions = {}): SearchIndex {
    const expand: SynonymExpander = synonymExpander(options.synonyms);
    const indexed: IndexedEntry[] = entries.map((entry) => {
        const counts = {} as Record<FieldName, ReadonlyMap<string, number>>;
        const lengths = {} as Record<FieldName, number>;
        for (const field of FIELDS) {
            const counted = countTerms(entry.fields[field]);
            counts[field] = counted.counts;
            lengths[field] = counted.length;
        }
        return {
            id: entry.id,
            counts,
            lengths,
            purposes: entry.fields.purposes.map((phrase) => ({ phrase, terms: new Set(tokenize(phrase)) }))
        };
    });
    const total = indexed.length;
    const averages = Object.fromEntries(FIELDS.map((field) => [field, total === 0 ? 0 : indexed.reduce((sum, entry) => sum + entry.lengths[field], 0) / total])) as Record<FieldName, number>;
    const documentFrequency = new Map<string, number>();
    for (const entry of indexed) {
        const seen = new Set<string>();
        for (const field of FIELDS) for (const term of entry.counts[field].keys()) seen.add(term);
        for (const term of seen) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }

    const idf = (term: string): number => {
        const df = documentFrequency.get(term) ?? 0;
        return Math.log(1 + (total - df + 0.5) / (df + 0.5));
    };

    /** The term's score in one entry and the fields it was found in */
    const termScore = (entry: IndexedEntry, term: string): { score: number; inPurposes: boolean; elsewhere: boolean } => {
        let frequency = 0;
        let inPurposes = false;
        let elsewhere = false;
        for (const field of FIELDS) {
            const count = entry.counts[field].get(term) ?? 0;
            if (count === 0) continue;
            if (field === 'purposes') inPurposes = true;
            else elsewhere = true;
            const average = averages[field] === 0 ? 1 : averages[field];
            frequency += (FIELD_WEIGHTS[field] * count) / (1 - BM25_B + (BM25_B * entry.lengths[field]) / average);
        }
        if (frequency === 0) return { score: 0, inPurposes, elsewhere };
        return { score: (idf(term) * frequency * (BM25_K1 + 1)) / (frequency + BM25_K1), inPurposes, elsewhere };
    };

    return {
        size: total,
        search(need, limit) {
            const terms = needTerms(need);
            if (terms.size === 0) return [];
            const hits: { hit: SearchHit; words: number }[] = [];
            for (const entry of indexed) {
                let score = 0;
                let matchedWords = 0;
                const purposeStems = new Set<string>();
                const otherWords: string[] = [];
                for (const [term, word] of terms) {
                    let best = { score: 0, stem: term, inPurposes: false, elsewhere: false };
                    for (const candidate of expand(term)) {
                        const result = termScore(entry, candidate);
                        if (result.score > best.score) best = { ...result, stem: candidate };
                    }
                    if (best.score === 0) continue;
                    score += best.score;
                    matchedWords += 1;
                    if (best.inPurposes) purposeStems.add(best.stem);
                    else otherWords.push(word);
                }
                if (score === 0) continue;
                const phrases = entry.purposes.filter((purpose) => [...purposeStems].some((term) => purpose.terms.has(term))).map((purpose) => purpose.phrase);
                hits.push({ hit: { id: entry.id, score, matched: [...phrases, ...otherWords] }, words: matchedWords });
            }
            hits.sort((left, right) => right.hit.score - left.hit.score || right.words - left.words || (left.hit.id < right.hit.id ? -1 : left.hit.id > right.hit.id ? 1 : 0));
            const ranked = hits.map((entry) => entry.hit);
            return limit === undefined ? ranked : ranked.slice(0, Math.max(0, limit));
        }
    };
}
