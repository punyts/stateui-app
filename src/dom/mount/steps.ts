import type { MountStep } from './types.js';

const steps = new Map<string, MountStep>();

/**
 * Registers a step that `mountApp` runs, in registration order. Registering a name again replaces the earlier step and
 * keeps its place in the order. Returns a function that removes it
 */
export function registerMountStep(name: string, step: MountStep): () => void {
    steps.set(name, step);
    return () => {
        if (steps.get(name) === step) steps.delete(name);
    };
}

/** The registered steps with their names, in the order they run */
export function mountSteps(): [string, MountStep][] {
    return [...steps.entries()];
}
