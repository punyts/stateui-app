import type { ComponentOptions, StateUIElement } from '@punyts/stateui';

export interface ComponentModule {
    readonly name: string;
    readonly tag: string;
    readonly defaultState: Record<string, unknown>;
    readonly options: ComponentOptions;
    register(): typeof StateUIElement;
}

export interface ComponentTokenEntry {
    readonly path: string;
    readonly group: string;
    readonly type: 'color' | 'dimension' | 'number' | 'duration' | 'easing' | 'shadow' | 'fontFamily' | 'fontWeight';
    readonly default: string;
}

export declare const components: ComponentModule[];
export declare const componentTokens: ComponentTokenEntry[];
export declare function registerAll(): (typeof StateUIElement)[];
