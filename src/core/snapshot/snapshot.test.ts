import { createStore } from '@punyts/state';
import { describe, expect, it } from 'vitest';
import { applyLinks, runtimePath } from '../links/index.js';
import { snapshotState } from './index.js';

const LIST = '$.app.children.orders';

function makeStore() {
    const store = createStore<Record<string, unknown>>({
        data: { orders: { k1: { id: 'k1', customer: 'Ada' }, k2: { id: 'k2', customer: 'Bob' } }, selected: 'k2' },
        app: {
            component: 'column',
            _title: 'Orders',
            on: { press: [{ command: 'set', target: '$.data.selected', value: 'k1' }] },
            children: {
                orders: { component: 'list', _title: 'All', rowHeight: 40 },
                detail: { component: 'text' },
                modal: { component: 'modal', open: true, _title: 'Confirm' },
                name: { component: 'field', value: 'typed', type: 'text' }
            }
        },
        runtime: { nodes: {}, icons: { plus: 'M0 0' }, empty: {} }
    });
    const slot = `${runtimePath(LIST)}.slots.0`;
    store.set(slot, { component: 'text', _text: 'slot' });
    store.set(`${runtimePath(LIST)}.current`, { id: 'k2' });
    const errors = applyLinks(store, [
        { statePath: slot, key: 'row', target: '$.data.orders.k2' },
        { statePath: `${slot}.children.x`, key: '_text', target: `${slot}.row.customer`, allowMissing: true },
        { statePath: '$.app.children.detail', key: '_text', target: '$.data.orders.k2.customer' },
        { statePath: '$.app.children.name', key: 'status', target: '$.data.selected' }
    ]);
    expect(errors).toEqual([]);
    return store;
}

describe('snapshotState', () => {
    it('returns the data and the articulation values, without runtime, links or content', () => {
        const store = makeStore();

        const snapshot = snapshotState(store);

        expect(snapshot.data).toEqual({
            orders: { k1: { id: 'k1', customer: 'Ada' }, k2: { id: 'k2', customer: 'Bob' } },
            selected: 'k2'
        });
        expect(snapshot.app).toEqual({
            children: {
                orders: { rowHeight: 40 },
                modal: { open: true },
                name: { value: 'typed', type: 'text' }
            }
        });
        const text = JSON.stringify(snapshot);
        expect(text).not.toContain('runtime');
        expect(text).not.toContain('slots');
        expect(text).not.toContain('current');
        expect(text).not.toContain('Confirm');
        expect(text).not.toContain('press');
    });

    it('leaves out a linked property and the data it points to is not copied under it', () => {
        const store = makeStore();

        const snapshot = snapshotState(store);

        expect(store.get('$.app.children.name.status')).toBe('k2');
        expect(snapshot.app).not.toHaveProperty('children.name.status');
        expect(JSON.stringify(snapshot.app)).not.toContain('k2');
    });

    it('removes a path for which exclude returns true, with everything below it', () => {
        const store = makeStore();
        const seen: string[] = [];

        const snapshot = snapshotState(store, {
            exclude: (path) => {
                seen.push(path);
                return path === '$.app.children.name.value' || path === '$.data.orders.k1';
            }
        });

        expect(snapshot.app).toEqual({
            children: { orders: { rowHeight: 40 }, modal: { open: true }, name: { type: 'text' } }
        });
        expect(snapshot.data).toEqual({ orders: { k2: { id: 'k2', customer: 'Bob' } }, selected: 'k2' });
        expect(seen).toContain('$.data.orders.k2.customer');
        expect(seen.some((path) => path.startsWith('$.runtime'))).toBe(false);
    });

    it('returns copies that share nothing with the store', () => {
        const store = makeStore();

        const snapshot = snapshotState(store);
        (snapshot.data.orders as Record<string, unknown>).k1 = 'changed';

        expect(store.get('$.data.orders.k1')).toEqual({ id: 'k1', customer: 'Ada' });
    });

    it('gives empty objects for a store without data or app', () => {
        const store = createStore<Record<string, unknown>>({ runtime: { nodes: {} } });

        expect(snapshotState(store)).toEqual({ data: {}, app: {} });
    });

    it('keeps arrays, dropping excluded items', () => {
        const store = createStore<Record<string, unknown>>({ data: { tags: ['a', 'b', 'c'] }, app: { component: 'x' } });

        const snapshot = snapshotState(store, { exclude: (path) => path === '$.data.tags.1' });

        expect(snapshot.data).toEqual({ tags: ['a', 'c'] });
    });
});
