import { createStore } from '@punyts/state';
import { describe, expect, it, vi } from 'vitest';
import { applyLinks, disposeLinks, extractLinks, resolveRowLinks, runtimePath } from './index.js';
import type { Node } from '../types.js';

const TREE: Node = {
    component: 'form',
    _title: 'Order',
    '<-value': '$.data.order.customer',
    children: {
        total: { component: 'text', '<-_text': '$.data.order.total', on: { press: [{ command: 'set', target: '$row.x' }] } },
        detail: { component: 'field', '<-value': '^orders.current.customer' },
        local: { component: 'field', '<-value': '.sibling.value' }
    }
};

function makeStore() {
    return createStore<Record<string, unknown>>({
        data: { order: { customer: 'Ada', total: 5 } },
        app: { children: { total: {} } },
        runtime: { nodes: {}, empty: {} }
    });
}

describe('extractLinks', () => {
    it('returns every link with its node path and the tree without the link keys', () => {
        const result = extractLinks(TREE);

        expect(result.errors).toEqual([]);
        expect(result.links).toEqual([
            { statePath: '$.app', key: 'value', target: '$.data.order.customer' },
            { statePath: '$.app.children.total', key: '_text', target: '$.data.order.total' },
            { statePath: '$.app.children.detail', key: 'value', target: '^orders.current.customer' },
            { statePath: '$.app.children.local', key: 'value', target: '.sibling.value' }
        ]);
        expect(JSON.stringify(result.tree)).not.toContain('<-');
        expect(result.tree._title).toBe('Order');
        expect(TREE['<-value']).toBe('$.data.order.customer');
    });

    it('exposes the linked paths so overlays can skip them', () => {
        const { linkedPaths } = extractLinks(TREE);

        expect(linkedPaths).toContain('$.app.children.total._text');
        expect(linkedPaths).toHaveLength(4);
    });

    it('uses the given root path', () => {
        const { links } = extractLinks({ component: 'text', '<-_text': '$.data.a' }, { path: '$.composed.x' });

        expect(links[0]?.statePath).toBe('$.composed.x');
    });

    it('rejects a target in $.server as server-only', () => {
        const result = extractLinks({ component: 'x', '<-a': '$.server', '<-b': '$.server.apiKey' });

        expect(result.links).toEqual([]);
        expect(result.errors.map((error) => error.code)).toEqual(['SUI-LINK-SERVER', 'SUI-LINK-SERVER']);
        expect(result.errors[1]?.message).toContain('server-only');
    });

    it('rejects a target outside $.data, $row and node references', () => {
        const result = extractLinks({
            component: 'x',
            '<-a': '$.app.other',
            '<-b': '$.database.x',
            '<-c': '..up.x',
            '<-d': 5,
            '<-': '$.data.a'
        });

        expect(result.links).toEqual([]);
        expect(result.errors.map((error) => error.code)).toEqual([
            'SUI-LINK-TARGET',
            'SUI-LINK-TARGET',
            'SUI-LINK-TARGET',
            'SUI-LINK-TARGET',
            'SUI-NODE-NAME'
        ]);
        expect(result.errors[0]?.statePath).toBe('$.app');
    });

    it('accepts $row targets as written', () => {
        const { links, errors } = extractLinks({ component: 'x', '<-a': '$row.customer', '<-b': '$row' });

        expect(errors).toEqual([]);
        expect(links.map((link) => link.target)).toEqual(['$row.customer', '$row']);
    });
});

describe('runtimePath', () => {
    it('maps a node path to its runtime branch', () => {
        expect(runtimePath('$.app.a.b')).toBe('$.runtime.nodes.app.a.b');
        expect(runtimePath('$.app')).toBe('$.runtime.nodes.app');
    });

    it('throws for a path that is not below $.', () => {
        expect(() => runtimePath('app.a')).toThrow();
        expect(() => runtimePath('$.')).toThrow();
    });
});

describe('applyLinks', () => {
    it('reads the data through the linked property', () => {
        const store = makeStore();

        const errors = applyLinks(store, extractLinks(TREE).links.slice(0, 2));

        expect(errors).toEqual([]);
        expect(store.get('$.app.value')).toBe('Ada');
        expect(store.get('$.app.children.total._text')).toBe(5);
    });

    it('writes through the field into the data', () => {
        const store = makeStore();
        applyLinks(store, [{ statePath: '$.app', key: 'value', target: '$.data.order.customer' }]);

        store.set('$.app.value', 'Grace');

        expect(store.get('$.data.order.customer')).toBe('Grace');
    });

    it('notifies the node when the data changes', () => {
        const store = makeStore();
        applyLinks(store, [{ statePath: '$.app', key: 'value', target: '$.data.order.customer' }]);
        const listener = vi.fn();
        store.on('$.app.value', listener);

        store.set('$.data.order.customer', 'Linus');

        expect(listener).toHaveBeenCalled();
    });

    it('reports a missing target with the node path', () => {
        const store = makeStore();

        const errors = applyLinks(store, [{ statePath: '$.app', key: 'value', target: '$.data.order.nothing' }]);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 'SUI-LINK-MISSING', statePath: '$.app' });
    });

    it('reports an unresolved node reference as missing', () => {
        const errors = applyLinks(makeStore(), [{ statePath: '$.app', key: 'value', target: '^orders.current.x' }]);

        expect(errors[0]?.code).toBe('SUI-LINK-MISSING');
    });

    it('reports a link that loops', () => {
        const store = createStore<Record<string, unknown>>({ data: { a: 1 }, app: {} });
        applyLinks(store, [{ statePath: '$.app', key: 'x', target: '$.data.a' }]);

        const inside = applyLinks(store, [{ statePath: '$.app', key: 'y', target: '$.app.y.z' }]);
        const loop = applyLinks(store, [{ statePath: '$.data', key: 'a', target: '$.app.x' }]);

        expect(inside[0]).toMatchObject({ code: 'SUI-LINK-CYCLE', statePath: '$.app' });
        expect(loop.map((error) => error.code)).toEqual(['SUI-LINK-CYCLE']);
    });

    it('is idempotent and notifies once', () => {
        const store = makeStore();
        const links = [{ statePath: '$.app', key: 'value', target: '$.data.order.customer' }];
        applyLinks(store, links);
        const listener = vi.fn();
        store.on('$.app.value', listener);

        const errors = applyLinks(store, links);

        expect(errors).toEqual([]);
        expect(listener).not.toHaveBeenCalled();
        expect(store.get('$.app.value')).toBe('Ada');
    });

    it('unlinks on dispose', () => {
        const store = makeStore();
        const links = [{ statePath: '$.app', key: 'value', target: '$.data.order.customer' }];
        applyLinks(store, links);

        disposeLinks(store, links);

        expect(store.get('$.app.value')).toBeUndefined();
        expect(applyLinks(store, links)).toEqual([]);
        expect(store.get('$.app.value')).toBe('Ada');
    });
});

describe('resolveRowLinks', () => {
    const rowPath = '$.runtime.nodes.app.orders.slots.3.row';
    const row: Node = { component: 'text', '<-_text': '$row.customer', '<-tone': '$.data.tone', _title: 'x' };

    it('rewrites $row targets to the slot row alias path with allowMissing', () => {
        const result = resolveRowLinks(row, rowPath);

        expect(result.errors).toEqual([]);
        expect(result.links).toEqual([
            {
                statePath: '$.runtime.nodes.app.orders.slots.3',
                key: '_text',
                target: `${rowPath}.customer`,
                allowMissing: true
            },
            { statePath: '$.runtime.nodes.app.orders.slots.3', key: 'tone', target: '$.data.tone' }
        ]);
        expect(result.tree).toEqual({ component: 'text', _title: 'x' });
    });

    it('links a slot to its record, tolerates a missing field and follows a re-point', () => {
        const store = createStore<Record<string, unknown>>({
            data: { orders: { k1: { customer: 'Ada' }, k2: {} } },
            runtime: { nodes: { app: { orders: { slots: { 3: {} } } } } }
        });
        const slot = '$.runtime.nodes.app.orders.slots.3';
        expect(store.link(`${slot}.row`, '$.data.orders.k1')).toBe(true);
        const { links } = resolveRowLinks(row, `${slot}.row`);
        const listener = vi.fn();

        const errors = applyLinks(store, links.slice(0, 1));
        store.on(`${slot}._text`, listener);
        store.link(`${slot}.row`, '$.data.orders.k2');

        expect(errors).toEqual([]);
        expect(store.get(`${slot}._text`)).toBeUndefined();
        expect(listener).toHaveBeenCalled();

        store.set('$.data.orders.k2.customer', 'Grace');
        expect(store.get(`${slot}._text`)).toBe('Grace');
    });

    it('honours an explicit node path', () => {
        const result = resolveRowLinks(row, rowPath, { path: '$.slot' });

        expect(result.links[0]?.statePath).toBe('$.slot');
    });
});
