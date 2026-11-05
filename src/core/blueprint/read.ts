import { buildError } from '../errors/index.js';
import type { BuildError } from '../errors/index.js';
import { isObject } from '../resolve/merge.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import { declarationProblems, isKeyName } from './declaration.js';
import { isPartName } from './names.js';
import type { AppBlueprint } from './types.js';

const BLUEPRINT_KEYS = ['title', 'uses', 'start', 'shell', 'screens', 'logic', 'locales'];
const USES_KEYS = ['themes', 'data', 'logic'];
const SCREEN_KEYS = ['title', 'params', 'root', 'locales'];
const MODULE_USE_KEYS = ['params'];
const LOGIC_KEYS = ['machines', 'rules', 'tables'];
const PERSONA_SCOPE = 'persona';

export interface ReadBlueprintResult {
    /** Absent when there are errors */
    blueprint?: AppBlueprint;
    errors: BuildError[];
}

class Reader {
    readonly errors: BuildError[] = [];

    shape(path: string, name: string): void {
        this.errors.push(buildError('SUI-BLUEPRINT-SHAPE', { path, name }));
    }

    /** Reports every key not in `allowed`; true when there was none */
    knownKeys(value: JsonObject, allowed: readonly string[], path: string): boolean {
        let known = true;
        for (const key of Object.keys(value)) {
            if (allowed.includes(key)) continue;
            this.shape(`${path}.${key}`, `unknown key "${key}"`);
            known = false;
        }
        return known;
    }

    object(value: JsonValue | undefined, path: string, what: string): value is JsonObject {
        if (isObject(value)) return true;
        this.shape(path, `${what} must be an object`);
        return false;
    }

    node(value: JsonValue | undefined, path: string): value is Node {
        if (isObject(value) && typeof value['component'] === 'string' && value['component'] !== '') return true;
        this.shape(path, 'a node must be an object with a "component" name');
        return false;
    }

    optionalText(value: JsonValue | undefined, path: string): void {
        if (value !== undefined && typeof value !== 'string') this.shape(path, 'must be text');
    }

    blueprint(json: JsonObject): void {
        this.knownKeys(json, BLUEPRINT_KEYS, '$');
        this.optionalText(json['title'], '$.title');
        if (json['uses'] !== undefined) this.uses(json['uses'], '$.uses');
        this.node(json['shell'], '$.shell');
        const screens = this.screens(json['screens'], '$.screens');
        const start = json['start'];
        if (typeof start !== 'string') this.shape('$.start', 'must name the first screen');
        else if (screens !== undefined && !Object.hasOwn(screens, start)) this.shape('$.start', `"${start}" names no screen`);
        if (json['logic'] !== undefined) this.logic(json['logic'], '$.logic');
        if (json['locales'] !== undefined) this.locales(json['locales'], '$.locales');
    }

    uses(value: JsonValue, path: string): void {
        if (!this.object(value, path, 'uses')) return;
        this.knownKeys(value, USES_KEYS, path);
        if (value['themes'] !== undefined) this.themes(value['themes'], `${path}.themes`);
        if (value['data'] !== undefined) this.data(value['data'], `${path}.data`);
        if (value['logic'] !== undefined) this.moduleUses(value['logic'], `${path}.logic`);
    }

    themes(value: JsonValue, path: string): void {
        if (!Array.isArray(value)) {
            this.shape(path, 'must be a list of theme names');
            return;
        }
        const seen = new Set<string>();
        value.forEach((name, index) => {
            if (!isPartName(name)) this.shape(`${path}.${index}`, 'must be a theme part name');
            else if (seen.has(name)) this.shape(`${path}.${index}`, `theme "${name}" is listed twice`);
            else seen.add(name);
        });
    }

    data(value: JsonValue, path: string): void {
        if (!this.object(value, path, 'uses.data')) return;
        for (const [name, binding] of Object.entries(value)) {
            const at = `${path}.${name}`;
            if (!isKeyName(name)) this.shape(at, `binding name "${name}" must be a key name`);
            this.binding(binding, at);
        }
    }

    binding(value: JsonValue, path: string): void {
        if (!this.object(value, path, 'a binding')) return;
        if (Object.hasOwn(value, 'dataset')) {
            if (!this.knownKeys(value, ['dataset'], path)) return;
            if (!isPartName(value['dataset'])) this.shape(`${path}.dataset`, 'must be a dataset part name');
            return;
        }
        if (Object.hasOwn(value, 'model')) {
            if (!this.knownKeys(value, ['model', 'scope'], path)) return;
            if (!isPartName(value['model'])) this.shape(`${path}.model`, 'must be a model part name');
            if (value['scope'] !== PERSONA_SCOPE) this.shape(`${path}.scope`, `a model binding must have scope "${PERSONA_SCOPE}"`);
            return;
        }
        this.shape(path, `a binding is { "dataset" } or { "model", "scope": "${PERSONA_SCOPE}" }`);
    }

    moduleUses(value: JsonValue, path: string): void {
        if (!this.object(value, path, 'uses.logic')) return;
        for (const [name, use] of Object.entries(value)) {
            const at = `${path}.${name}`;
            if (!isPartName(name)) this.shape(at, `"${name}" must be a logic module part name`);
            if (!this.object(use, at, 'a module use')) continue;
            this.knownKeys(use, MODULE_USE_KEYS, at);
            if (use['params'] !== undefined) this.object(use['params'], `${at}.params`, 'params');
        }
    }

    screens(value: JsonValue | undefined, path: string): JsonObject | undefined {
        if (!this.object(value, path, 'screens')) return undefined;
        if (Object.keys(value).length === 0) this.shape(path, 'an app needs at least one screen');
        for (const [name, screen] of Object.entries(value)) {
            const at = `${path}.${name}`;
            if (!isPartName(name)) this.shape(at, `screen name "${name}" must be a part name`);
            if (!this.object(screen, at, 'a screen')) continue;
            this.knownKeys(screen, SCREEN_KEYS, at);
            this.optionalText(screen['title'], `${at}.title`);
            if (screen['params'] !== undefined) this.declarations(screen['params'], `${at}.params`);
            if (screen['root'] === undefined) this.shape(`${at}.root`, 'a screen needs a root node');
            else this.node(screen['root'], `${at}.root`);
            if (screen['locales'] !== undefined) this.locales(screen['locales'], `${at}.locales`);
        }
        return value;
    }

    /** Typed declarations by name, as screen params, module params and model fields are */
    declarations(value: JsonValue, path: string): void {
        if (!this.object(value, path, 'params')) return;
        for (const [name, declaration] of Object.entries(value)) {
            const at = `${path}.${name}`;
            if (!isKeyName(name)) this.shape(at, `param name "${name}" must be a key name`);
            this.declaration(declaration, at);
        }
    }

    declaration(value: JsonValue, path: string): void {
        for (const problem of declarationProblems(value, path)) this.shape(problem.path, problem.reason);
    }

    logic(value: JsonValue, path: string): void {
        if (!this.object(value, path, 'logic')) return;
        this.knownKeys(value, LOGIC_KEYS, path);
        for (const key of LOGIC_KEYS) {
            if (value[key] !== undefined) this.object(value[key], `${path}.${key}`, key);
        }
    }

    locales(value: JsonValue, path: string): void {
        if (!this.object(value, path, 'locales')) return;
        for (const [name, messages] of Object.entries(value)) this.object(messages, `${path}.${name}`, 'a locale');
    }
}

/**
 * Reads an app blueprint: its keys, the shape of `uses`, the shell and screen nodes, typed screen params and `start`.
 * The contents of `logic`, the parts `uses` names and the shell's `outlet` are checked when the app is assembled
 */
export function readBlueprint(json: JsonValue): ReadBlueprintResult {
    const reader = new Reader();
    if (!isObject(json)) {
        reader.shape('$', 'a blueprint must be an object');
        return { errors: reader.errors };
    }
    reader.blueprint(json);
    if (reader.errors.length > 0) return { errors: reader.errors };
    return { blueprint: json as unknown as AppBlueprint, errors: [] };
}

