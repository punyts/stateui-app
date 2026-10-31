import type { ComponentOptions, StateUIElement } from '@punyts/stateui';

export interface ComponentModule {
    readonly name: string;
    readonly tag: string;
    readonly defaultState: Record<string, unknown>;
    readonly options: ComponentOptions;
    register(): typeof StateUIElement;
}

export declare const components: ComponentModule[];
export declare function registerAll(): (typeof StateUIElement)[];
