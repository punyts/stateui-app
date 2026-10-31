import type { JsonObject } from '../types.js';

/** The part of a store that a snapshot needs */
export interface SnapshotStore {
    get: (path: string) => unknown;
}

export interface SnapshotOptions {
    /**
     * Called with the state path of every value before it is copied (`$.data.user.name`, `$.app.children.a.open`);
     * `true` leaves that value, and everything below it, out. The caller uses it for password-type fields
     */
    exclude?: (path: string) => boolean;
}

/** The state worth saving: the data and the articulation values of the node tree */
export interface StateSnapshot {
    data: JsonObject;
    /** The node tree reduced to its articulation values; nodes without any are absent */
    app: JsonObject;
}
