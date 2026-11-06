import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import type { ComponentFiles, FileMap, ScannedComponent } from './types.js';

/** Lower-case words joined by single hyphens; the tag and the camel-cased name both derive from it */
const FOLDER_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const LOCALE_CODE = /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/;
const LOCALE_ROLE = /^locale\.(.+)\.json$/;

const FILE_ROLES: ReadonlyMap<string, keyof ComponentFiles> = new Map([
    ['view.html', 'view'],
    ['view.css', 'css'],
    ['controller.ts', 'controller'],
    ['state.json', 'state'],
    ['composed.json', 'composed']
]);

export interface ScanResult {
    /** Valid components, sorted by name */
    components: ScannedComponent[];
    /** Every problem found, in path order; a component with a problem is absent from `components` */
    errors: BuildError[];
}

interface Folder {
    path: string;
    name: string;
    group: string;
    folder: string;
    files: ComponentFiles;
    locales: Record<string, string>;
    paths: string[];
    broken: boolean;
}

function camelCase(folder: string): string {
    return folder.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

function nameError(file: string, name: string): BuildError {
    return buildError('SUI-BUILD-NAME', { file, name });
}

function duplicateError(component: string, files: readonly string[]): BuildError {
    return buildError('SUI-BUILD-DUPLICATE', { component, file: files[0] ?? '', other: files.slice(1).join(', ') });
}

/**
 * Turns a component library folder into a list of components by file convention alone:
 * `<group>/<name>/<name>.<role>.<ext>`. Pure over the paths; nothing is read or registered
 */
export function scanLibrary(fileMap: FileMap): ScanResult {
    const errors: BuildError[] = [];
    const folders = new Map<string, Folder>();

    for (const path of Object.keys(fileMap).sort()) {
        const segments = path.split('/');
        const fileName = segments[segments.length - 1] ?? '';
        if (segments.length < 2 || segments.some((segment) => segment === '')) {
            errors.push(buildError('SUI-BUILD-FILE', { file: path }));
            continue;
        }

        const folderPath = segments.slice(0, -1).join('/');
        let folder = folders.get(folderPath);
        if (!folder) {
            const folderName = segments[segments.length - 2] ?? '';
            folder = {
                path: folderPath,
                name: camelCase(folderName),
                group: segments.slice(0, -2).join('/'),
                folder: folderName,
                files: {},
                locales: {},
                paths: [],
                broken: false
            };
            folders.set(folderPath, folder);
        }
        folder.paths.push(path);

        if (!FOLDER_NAME.test(folder.folder)) {
            folder.broken = true;
            errors.push(nameError(path, folder.folder));
            continue;
        }

        const prefix = `${folder.folder}.`;
        if (!fileName.startsWith(prefix)) {
            folder.broken = true;
            errors.push(buildError('SUI-BUILD-ROLE', { file: path, name: folder.folder }));
            continue;
        }

        const role = fileName.slice(prefix.length);
        const fileRole = FILE_ROLES.get(role);
        const locale = LOCALE_ROLE.exec(role)?.[1];
        if (fileRole !== undefined) {
            folder.files[fileRole] = path;
        } else if (locale !== undefined && LOCALE_CODE.test(locale)) {
            folder.locales[locale] = path;
        } else {
            folder.broken = true;
            errors.push(buildError('SUI-BUILD-ROLE', { file: path, name: folder.folder }));
        }
    }

    const byName = new Map<string, Folder[]>();
    for (const folder of folders.values()) {
        if (!FOLDER_NAME.test(folder.folder)) continue;
        const same = byName.get(folder.name) ?? [];
        same.push(folder);
        byName.set(folder.name, same);
    }
    for (const same of byName.values()) {
        if (same.length < 2) continue;
        for (const folder of same) folder.broken = true;
        const files = same.map((folder) => folder.paths[0] ?? folder.path);
        errors.push(duplicateError(same[0]?.name ?? '', files));
    }

    const components: ScannedComponent[] = [];
    for (const folder of folders.values()) {
        if (folder.broken) continue;
        const { files } = folder;
        const where = folder.paths[0] ?? folder.path;
        const hasRootFile = files.view !== undefined || files.state !== undefined;
        const hasViewFile = hasRootFile || files.css !== undefined || files.controller !== undefined;

        if (files.composed !== undefined && hasViewFile) {
            errors.push(buildError('SUI-BUILD-TIER', { component: folder.name, file: where }));
            continue;
        }
        const isShape = files.composed === undefined && files.view === undefined && files.state !== undefined;
        if (isShape && (files.css !== undefined || files.controller !== undefined)) {
            errors.push(buildError('SUI-BUILD-TIER-SHAPE', { component: folder.name, file: where }));
            continue;
        }
        if (files.composed === undefined && !isShape) {
            if (files.view === undefined || files.state === undefined) {
                const missing = files.view === undefined ? 'view.html' : 'state.json';
                errors.push(buildError('SUI-BUILD-MISSING', { component: folder.name, file: where, name: `${folder.folder}.${missing}` }));
                continue;
            }
        }

        components.push({
            name: folder.name,
            tier: isShape ? 'shape' : files.composed === undefined ? 'root' : 'composed',
            ...(isShape ? {} : { tag: `ui-${folder.folder}` }),
            group: folder.group,
            files,
            locales: Object.fromEntries(Object.entries(folder.locales).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        });
    }

    components.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { components, errors };
}
