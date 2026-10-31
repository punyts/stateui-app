import { describe, expect, it } from 'vitest';
import { MAX_DATA_BYTES, MAX_DEPTH, MAX_DOCUMENT_BYTES, MAX_NODES, checkLimits } from './limits.js';
import { PREFIXES, RESERVED_KEYS } from './types.js';
import type { AppDocument, JsonObject, Node } from './types.js';

function flatApp(count: number): Node {
    const children: JsonObject = {};
    for (let i = 0; i < count - 1; i++) children[`n${i}`] = { component: 'text' };
    return { component: 'page', children };
}

function chain(levels: number): Node {
    let node: Node = { component: 'text' };
    for (let i = 1; i < levels; i++) node = { component: 'panel', children: { c: node } };
    return node;
}

/** A document whose serialised size is exactly `bytes` */
function documentOfBytes(bytes: number): AppDocument {
    const base: AppDocument = { app: { component: 'page', pad: '' } };
    const overhead = new TextEncoder().encode(JSON.stringify(base)).length;
    return { app: { component: 'page', pad: 'x'.repeat(bytes - overhead) } };
}

describe('closed limits', () => {
    it('chooses the documented values', () => {
        expect([MAX_NODES, MAX_DEPTH, MAX_DOCUMENT_BYTES, MAX_DATA_BYTES]).toEqual([2000, 32, 1048576, 524288]);
    });

    it('accepts a small document', () => {
        expect(checkLimits({ app: { component: 'page' } })).toEqual([]);
    });

    it('accepts exactly the node limit and rejects one more', () => {
        expect(checkLimits({ app: flatApp(MAX_NODES) })).toEqual([]);
        const errors = checkLimits({ app: flatApp(MAX_NODES + 1) });

        expect(errors.map((error) => error.code)).toEqual(['SUI-DOC-LIMIT-NODES']);
    });

    it('counts composed trees toward the node limit', () => {
        const errors = checkLimits({ app: flatApp(MAX_NODES), composed: { extra: { component: 'text' } } });

        expect(errors.map((error) => error.code)).toEqual(['SUI-DOC-LIMIT-NODES']);
    });

    it('accepts exactly the depth limit and rejects one more', () => {
        expect(checkLimits({ app: chain(MAX_DEPTH) })).toEqual([]);
        const errors = checkLimits({ app: chain(MAX_DEPTH + 1) });

        expect(errors).toHaveLength(1);
        expect(errors[0]?.code).toBe('SUI-DOC-LIMIT-DEPTH');
        expect(errors[0]?.statePath).toMatch(/^\$\.app/);
    });

    it('checks the depth of composed trees from their own root', () => {
        const errors = checkLimits({ app: { component: 'page' }, composed: { deep: chain(MAX_DEPTH + 1) } });

        expect(errors[0]?.code).toBe('SUI-DOC-LIMIT-DEPTH');
        expect(errors[0]?.statePath).toMatch(/^\$\.composed\.deep/);
    });

    it('accepts exactly the document byte limit and rejects one byte over', () => {
        expect(checkLimits(documentOfBytes(MAX_DOCUMENT_BYTES))).toEqual([]);
        const errors = checkLimits(documentOfBytes(MAX_DOCUMENT_BYTES + 1));

        expect(errors.map((error) => error.code)).toEqual(['SUI-DOC-LIMIT-BYTES']);
    });

    it('accepts exactly the data byte limit and rejects one byte over', () => {
        const at = (bytes: number): AppDocument => ({
            app: { component: 'page' },
            data: { pad: 'x'.repeat(bytes - '{"pad":""}'.length) }
        });

        expect(checkLimits(at(MAX_DATA_BYTES))).toEqual([]);
        expect(checkLimits(at(MAX_DATA_BYTES + 1)).map((error) => error.code)).toEqual(['SUI-DOC-LIMIT-DATA']);
    });

    it('counts bytes, not characters', () => {
        const document: AppDocument = { app: { component: 'page' }, data: { pad: 'é'.repeat(MAX_DATA_BYTES / 2) } };

        expect(checkLimits(document).map((error) => error.code)).toEqual(['SUI-DOC-LIMIT-DATA']);
    });

    it('does not count data objects with a component key outside app and composed', () => {
        const data: JsonObject = {};
        for (let i = 0; i < MAX_NODES + 5; i++) data[`r${i}`] = { component: 'x' };

        expect(checkLimits({ app: { component: 'page' }, data })).toEqual([]);
    });

    it('reports a document that cannot be serialised', () => {
        const app: Node = { component: 'page' };
        app['self'] = app;

        expect(checkLimits({ app }).map((error) => error.code)).toEqual(['SUI-DOC-SHAPE']);
    });

    it('walks a very deep plain nesting without overflowing the stack', () => {
        let nested: JsonObject = {};
        const root = nested;
        for (let i = 0; i < 4000; i++) {
            const next: JsonObject = {};
            nested['n'] = next;
            nested = next;
        }

        expect(checkLimits({ app: { component: 'page', extra: root } })).toEqual([]);
    });
});

describe('reserved vocabulary', () => {
    it('names the reserved keys and prefixes', () => {
        expect(Object.values(RESERVED_KEYS)).toEqual(['component', 'children', 'layout', 'placement', 'theme', 'on']);
        expect(PREFIXES).toEqual({ content: '_', link: '<-', reserved: '__' });
    });
});
