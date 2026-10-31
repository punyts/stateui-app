/** The closed lists of the shared articulation properties: one vocabulary every component uses */
export const ARTICULATION_LISTS = {
    tone: ['neutral', 'accent', 'danger', 'warning', 'success', 'info'],
    variant: ['solid', 'soft', 'outline', 'ghost', 'link'],
    size: ['sm', 'md', 'lg'],
    density: ['compact', 'comfortable', 'spacious'],
    elevation: ['flat', 'raised', 'overlay'],
    textRole: ['display', 'title', 'heading', 'body', 'label', 'caption', 'code']
} as const;

/** A shared property a shape declares in `shared`; each has a closed list of values */
export type SharedName = keyof typeof ARTICULATION_LISTS;

/** The shared properties a shape may declare, in vocabulary order */
export const SHARED_NAMES = Object.keys(ARTICULATION_LISTS) as SharedName[];

/** `hidden` is a boolean every component has; a shape does not declare it */
export const HIDDEN = 'hidden';

/** Every articulation property: the shared names and `hidden` */
export type ArticulationName = SharedName | typeof HIDDEN;

/** Every articulation property name, `hidden` last */
export const ARTICULATION_NAMES: readonly ArticulationName[] = [...SHARED_NAMES, HIDDEN];

/** True when the name is one of the six shared properties that take a closed list */
export function isSharedName(name: string): name is SharedName {
    return Object.hasOwn(ARTICULATION_LISTS, name);
}

/** True when the name is a shared property or `hidden`: a component's own property may not use it */
export function isArticulationName(name: string): name is ArticulationName {
    return isSharedName(name) || name === HIDDEN;
}

/** The allowed values of a shared property, as a fresh list */
export function closedList(name: SharedName): string[] {
    return [...ARTICULATION_LISTS[name]];
}

/** The host attribute of a property: the name in kebab case, so `textRole` is `text-role` */
export function attributeName(property: string): string {
    return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
