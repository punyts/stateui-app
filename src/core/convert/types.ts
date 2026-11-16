import type { AppBlueprint, ComposedPart, DatasetPart, ModelPart, PartKind, ThemePart } from '../blueprint/types.js';
import type { AppDocument, JsonObject } from '../types.js';

/** One stored app of the old single-document form */
export interface SplitInput {
    /** The app's stored name; it becomes the app's slug and its `title` */
    name: string;
    document: AppDocument;
    /**
     * The stored state snapshot (`{ data, app }`): its `data` is the live data and wins over the document's `data`; the
     * articulation under `app` is dropped
     */
    snapshot?: JsonObject;
    /** Part names the owner already has, by kind; a new name that clashes with one gets a numeric suffix */
    taken?: Partial<Record<PartKind, Iterable<string>>>;
}

/** Something the converter could not convert, at a path of the old document, with why */
export interface SplitProblem {
    path: string;
    reason: string;
}

/** A name the converter changed to make it a slug or to avoid a clash */
export interface SplitRename {
    kind: PartKind | 'screens';
    from: string;
    to: string;
}

/** The app as owner parts; with problems in `report` there are no parts at all */
export interface SplitResult {
    /** The app's part name and blueprint; absent when the report lists problems */
    app?: { name: string; blueprint: AppBlueprint };
    themes: Record<string, ThemePart>;
    models: Record<string, ModelPart>;
    datasets: Record<string, DatasetPart>;
    components: Record<string, ComposedPart>;
    /** Every name that differs from the old one */
    renamed: SplitRename[];
    /** What could not be converted; the app converts again once these are fixed by hand */
    report: SplitProblem[];
}
