/** A library folder as a map from relative path (forward slashes) to file content; only the paths are read */
export type FileMap = Readonly<Record<string, unknown>>;

/** A root component has a view and a shape; a composed component is one JSON tree */
export type ComponentTier = 'root' | 'composed';

/** The paths of a component's files, by role. Locale files are listed in `ScannedComponent.locales` */
export interface ComponentFiles {
    view?: string;
    css?: string;
    controller?: string;
    state?: string;
    composed?: string;
}

export interface ScannedComponent {
    /** Camel-cased folder name, the name used in state */
    name: string;
    tier: ComponentTier;
    /** `ui-` plus the folder name */
    tag: string;
    /** The parent folders joined with `/`, empty when the component folder is at the top */
    group: string;
    files: ComponentFiles;
    /** Locale code to file path, in code order */
    locales: Record<string, string>;
}
