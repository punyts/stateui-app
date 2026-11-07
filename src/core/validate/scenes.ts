import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { entryShape } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { nodeChildren } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { JsonObject, Node } from '../types.js';
import type { DocumentValidationContext } from './types.js';

/** The component of a 3D scene: each one draws with its own WebGL context */
export const SCENE3D_COMPONENT = 'scene3d';

/** The WebGL contexts Chromium keeps alive on one page; a 17th loses the oldest for good (G3.1) */
export const MAX_SCENES_PER_PAGE = 16;

const APP_PATH = '$.app';

function shapeOf(library: ComponentLibrary, component: string): Shape | undefined {
    return Object.hasOwn(library, component) ? entryShape(library[component]) : undefined;
}

/** The `scene3d` nodes of one resolved tree, at any depth (slots and node fields of map items included) */
function countScenes(root: Node, rootPath: string, library: ComponentLibrary): number {
    let count = 0;
    const stack: [Node, string][] = [[root, rootPath]];
    while (stack.length > 0) {
        const [node, path] = stack.pop() as [Node, string];
        if (node.component === SCENE3D_COMPONENT) count += 1;
        for (const child of nodeChildren(node as JsonObject, path, shapeOf(library, node.component))) stack.push([child.node as Node, child.path]);
    }
    return count;
}

/**
 * The `scenes` plug-in of `validateDocument` (G3.4 of the graphics epic 3): a warning (`SUI-DOC-LIMIT-SCENES`) when one
 * page would show more than `MAX_SCENES_PER_PAGE` `scene3d` nodes. Each scene has its own WebGL context and Chromium
 * keeps at most 16 per page, so past that the oldest scenes lose theirs and show `_fallback`. A page is the `app` tree
 * (the shell) together with one screen: a shell over the limit is warned once at `$.app`, otherwise each screen whose
 * scenes and the shell's are over it is warned at `$.screens.{name}`. Composed trees are counted where they are used
 */
export function validateSceneCount(context: DocumentValidationContext): BuildError[] {
    const shell = countScenes(context.tree.node, APP_PATH, context.library);
    const warn = (path: string, actual: number): BuildError =>
        buildError('SUI-DOC-LIMIT-SCENES', { path, actual, limit: MAX_SCENES_PER_PAGE, statePath: path });
    if (shell > MAX_SCENES_PER_PAGE) return [warn(APP_PATH, shell)];
    const errors: BuildError[] = [];
    for (const [name, tree] of Object.entries(context.screens ?? {})) {
        const path = `$.screens.${name}`;
        const total = shell + countScenes(tree.node, path, context.library);
        if (total > MAX_SCENES_PER_PAGE) errors.push(warn(path, total));
    }
    return errors;
}
