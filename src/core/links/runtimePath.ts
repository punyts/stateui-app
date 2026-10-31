/** The branches of `$.runtime`; a document never contains it */
export const RUNTIME_PATHS = {
    nodes: '$.runtime.nodes',
    icons: '$.runtime.icons',
    empty: '$.runtime.empty'
} as const;

/**
 * Maps a node path to its runtime branch: `$.app.a.b` gives `$.runtime.nodes.app.a.b`. This is the only place
 * that builds runtime paths for nodes. `$.runtime.icons` and `$.runtime.empty` are separate keys, not node paths.
 * A path that does not start with `$.` is a programming error and throws
 */
export function runtimePath(appPath: string): string {
    if (!appPath.startsWith('$.') || appPath.length === 2) {
        throw new Error(`runtimePath needs a path below "$.", got "${appPath}"`);
    }
    return `${RUNTIME_PATHS.nodes}.${appPath.slice(2)}`;
}
