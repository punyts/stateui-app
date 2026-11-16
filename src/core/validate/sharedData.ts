import type { AppBlueprint } from '../blueprint/types.js';
import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import type { AppMode } from './types.js';

/**
 * `SUI-SYNC-SHARED` for each binding of an app part to a shared dataset when the app runs in `persisted` mode. A
 * shared dataset is kept in step across the apps that bind it by the app server (the server's dataset hub), and a
 * Persisted app has none: it keeps its state on the statenet, so its copy of the records would drift. Persona bindings
 * are the persona's own and are allowed; `standalone`, `full` and no mode allow every binding
 */
export function checkSharedData(blueprint: AppBlueprint, mode: AppMode | undefined): BuildError[] {
    if (mode !== 'persisted') return [];
    const errors: BuildError[] = [];
    for (const [name, binding] of Object.entries(blueprint.uses?.data ?? {})) {
        if (!('dataset' in binding)) continue;
        const path = `$.uses.data.${name}`;
        errors.push(buildError('SUI-SYNC-SHARED', { name, path, target: binding.dataset, other: mode, statePath: path }));
    }
    return errors;
}
