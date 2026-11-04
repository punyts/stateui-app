import type { ComponentToken } from '../core/theme/index.js';
import type { JsonObject } from '../core/types.js';

/** What one root component's module is made from */
export interface ModuleSource {
    name: string;
    tag: string;
    template: string;
    styles?: string;
    defaultState: JsonObject;
    /** True when a compiled `<name>.controller.js` sits next to the module */
    controller: boolean;
}

const string = (value: string): string => JSON.stringify(value);

/** The text of one component module: a plain description plus a `register` function that calls `defineComponent` */
export function emitModule(source: ModuleSource): string {
    const lines: string[] = ["import { defineComponent } from '@punyts/stateui';"];
    if (source.controller) lines.push(`import controller from './${source.name}.controller.js';`);
    lines.push(
        '',
        `export const name = ${string(source.name)};`,
        `export const tag = ${string(source.tag)};`,
        `export const defaultState = ${JSON.stringify(source.defaultState, null, 4)};`,
        'export const options = {',
        '    tag,',
        `    template: ${string(source.template)}${source.styles !== undefined || source.controller ? ',' : ''}`
    );
    if (source.styles !== undefined) lines.push(`    styles: ${string(source.styles)}${source.controller ? ',' : ''}`);
    if (source.controller) lines.push('    controller');
    lines.push('};', '', 'export function register() {', '    return defineComponent(options);', '}', '');
    return lines.join('\n');
}

/** The type declarations that go with a component module */
export function emitModuleTypes(): string {
    return [
        "import type { ComponentOptions, StateUIElement } from '@punyts/stateui';",
        '',
        'export declare const name: string;',
        'export declare const tag: string;',
        'export declare const defaultState: Record<string, unknown>;',
        'export declare const options: ComponentOptions;',
        'export declare function register(): typeof StateUIElement;',
        ''
    ].join('\n');
}

/** The index: every built module in name order, the library's component tokens and `registerAll` */
export function emitIndex(names: readonly string[], tokens: readonly ComponentToken[] = []): string {
    const lines: string[] = names.map((name, index) => `import * as component${index} from './${name}.js';`);
    lines.push(
        '',
        `export const components = [${names.map((_name, index) => `component${index}`).join(', ')}];`,
        '',
        `export const componentTokens = ${JSON.stringify(tokens, null, 4)};`,
        '',
        'export function registerAll() {',
        '    return components.map((component) => component.register());',
        '}',
        ''
    );
    return lines.join('\n');
}

export function emitIndexTypes(): string {
    return [
        "import type { ComponentOptions, StateUIElement } from '@punyts/stateui';",
        '',
        'export interface ComponentModule {',
        '    readonly name: string;',
        '    readonly tag: string;',
        '    readonly defaultState: Record<string, unknown>;',
        '    readonly options: ComponentOptions;',
        '    register(): typeof StateUIElement;',
        '}',
        '',
        'export interface ComponentTokenEntry {',
        '    readonly path: string;',
        '    readonly group: string;',
        "    readonly type: 'color' | 'dimension' | 'inset' | 'number' | 'duration' | 'easing' | 'shadow' | 'fontFamily' | 'fontWeight';",
        '    readonly default: string;',
        '}',
        '',
        'export declare const components: ComponentModule[];',
        'export declare const componentTokens: ComponentTokenEntry[];',
        'export declare function registerAll(): (typeof StateUIElement)[];',
        ''
    ].join('\n');
}
