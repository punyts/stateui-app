import { describe, expect, it } from 'vitest';
import { resolveNode } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { cloneJson, isObject } from '../resolve/merge.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { JsonObject, JsonValue, Node } from '../types.js';
import { createLogicEngine, createLogicIndex, readLogic } from './index.js';
import type { LogicDocument, LogicFailure, LogicHost, LogicWrite } from './index.js';

/**
 * The rule Magnetic's "Shows a computed value" writes (docs/design/magnetic-editor-links-and-presses.md, case 3): a
 * rule on a dataset sets a named text's content property to a value wrapped in `string()`
 */

function shapeOf(definition: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', commands: [], ...definition }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const LIBRARY: ComponentLibrary = Object.freeze({
    page: { tier: 'root', tag: 'ui-page', shape: shapeOf({ properties: {}, events: [] }) },
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({ properties: {}, events: [] }) },
    text: { tier: 'root', tag: 'ui-text', shape: shapeOf({ properties: { _text: { type: 'string', kind: 'content', default: '' } }, events: [] }) }
});

const SCREENS: Record<string, Node> = Object.freeze({
    home: { component: 'panel', children: { text: { component: 'text', '@id': 'count', _text: '0' } } }
}) as unknown as Record<string, Node>;

const TEXT = '$.screens.home.children.text._text';

function rule(value: string): LogicDocument {
    return { rules: { countText: { when: { path: '$.data.books' }, do: [{ command: 'set', target: '#count._text', value }] } } } as unknown as LogicDocument;
}

function walk(state: JsonValue, path: string): JsonValue | undefined {
    let current: JsonValue | undefined = state;
    for (const step of path.slice(2).split('.')) {
        if (!isObject(current)) return undefined;
        current = current[step];
    }
    return current;
}

/** A host over plain JSON holding two books */
function host() {
    const state = {
        root: {
            data: { books: { r1: { title: 'Emma', pages: 474 }, r2: { title: 'Middlemarch', pages: 880 } } },
            route: { screen: 'home' },
            screens: { home: { children: { text: { _text: '0' } } } }
        } as JsonValue
    };
    const failures: LogicFailure[] = [];
    const get = (path: string): JsonValue | undefined => walk(state.root, path);
    const apply = (write: LogicWrite): void => {
        const steps = write.path.slice(2).split('.');
        let current = state.root as JsonObject;
        for (const step of steps.slice(0, -1)) {
            if (!isObject(current[step])) current[step] = {};
            current = current[step] as JsonObject;
        }
        const last = steps[steps.length - 1] as string;
        if (write.value === undefined) delete current[last];
        else current[last] = cloneJson(write.value);
    };
    const trees = Object.fromEntries(
        Object.entries(SCREENS).map(([name, root]) => {
            const resolved = resolveNode(cloneJson(root as unknown as JsonValue) as unknown as Node, LIBRARY, {}, { path: `$.screens.${name}` });
            return [name, { node: resolved.node, instances: resolved.instances }];
        })
    );
    const index = createLogicIndex(resolveNode({ component: 'page' } as Node, LIBRARY, {}), LIBRARY, undefined, { trees, current: () => get('$.route.screen') as string | undefined });
    const logicHost: LogicHost = {
        get,
        commit: (writes) => writes.forEach(apply),
        resolve: index.resolve,
        fields: index.fields,
        initial: index.initial,
        screens: () => ({ home: {} }),
        failed: (failure) => failures.push(failure)
    };
    return { host: logicHost, index, failures, get, apply };
}

describe('A computed value: a rule that sets a named text', () => {
    it("should accept a set of a text's content property by its name, with no error or warning", () => {
        // Arrange
        const { index } = host();

        // Act
        const result = readLogic(rule('{{ string(size($.data.books)) }}'), { resolve: index.resolve });

        // Assert
        expect(result.errors).toEqual([]);
    });

    it('should write the count as a string at start and again when a record is added', () => {
        // Arrange
        const memory = host();
        const engine = createLogicEngine(rule('{{ string(size($.data.books)) }}'), memory.host);

        // Act
        engine.start();
        const atStart = memory.get(TEXT);
        memory.apply({ path: '$.data.books.r3', value: { title: 'Persuasion', pages: 249 } });
        engine.changes([{ path: '$.data.books.r3', value: { title: 'Persuasion', pages: 249 }, explicit: true }]);

        // Assert
        expect(memory.failures).toEqual([]);
        expect(atStart).toBe('2');
        expect(memory.get(TEXT)).toBe('3');
    });

    it('should write a sum, the smallest and the largest of a field as strings', () => {
        // Arrange
        const values = ["{{ string(sum($.data.books, 'pages')) }}", "{{ string(min($.data.books, 'pages')) }}", "{{ string(max($.data.books, 'pages')) }}"];

        // Act
        const written = values.map((value) => {
            const memory = host();
            createLogicEngine(rule(value), memory.host).start();
            expect(memory.failures).toEqual([]);
            return memory.get(TEXT);
        });

        // Assert
        expect(written).toEqual(['1354', '474', '880']);
    });
});
