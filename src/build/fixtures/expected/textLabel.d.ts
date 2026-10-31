import type { ComponentOptions, StateUIElement } from '@punyts/stateui';

export declare const name: string;
export declare const tag: string;
export declare const defaultState: Record<string, unknown>;
export declare const options: ComponentOptions;
export declare function register(): typeof StateUIElement;
