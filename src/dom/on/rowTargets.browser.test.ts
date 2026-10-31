import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import type { Store } from '@punyts/state';
import { defineComponent, mount, setNodeResolver, unmount } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { Shape } from '../../core/shape/index.js';
import { createDispatcher } from './index.js';
import type { CommandElement } from './index.js';

function shapeOf(properties: Record<string, unknown>, events: string[], commands: string[]): Shape {
    const result = parseShape({ summary: 'Fixture', properties, events, commands }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const library: ComponentLibrary = {
    panel: {
        tier: 'root',
        tag: 'x-row-panel',
        shape: shapeOf({ children: { type: 'map', items: 'string', default: {} } }, [], [])
    },
    button: { tier: 'root', tag: 'x-row-button', shape: shapeOf({ enabled: { type: 'boolean', default: true } }, ['press'], []) },
    records: {
        tier: 'root',
        tag: 'x-row-records',
        shape: shapeOf({ picked: { type: 'string', default: '' }, row: { type: 'node', row: true } }, [], ['delete'])
    }
};

defineComponent({
    tag: 'x-row-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-row-button', template: '<b>button</b>' });
defineComponent({ tag: 'x-row-records', template: '<i>records</i>' });

const tags: Record<string, string> = { panel: 'x-row-panel', button: 'x-row-button', records: 'x-row-records' };

const OWNER = '$.app.children.orders';
const SLOT = '$.runtime.nodes.app.children.orders.slots.3';

function find(root: ParentNode, path: string): HTMLElement | undefined {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        const scope = (candidate as { scope?: { basePath?: string } }).scope;
        if (scope?.basePath === path && candidate.localName.startsWith('x-row-')) return candidate as HTMLElement;
        const inner = candidate.shadowRoot ? find(candidate.shadowRoot, path) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

function raise(element: Element, name: string): void {
    element.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
}

interface Fixture {
    store: Store<unknown>;
    button: HTMLElement;
    owner: HTMLElement;
    onError: ReturnType<typeof vi.fn>;
}

/**
 * A record view at `$.app.children.orders` whose slot 3 holds a button (the row template) showing record k1. With
 * `renderAt` the button renders there instead, through an alias of the owner's `slots` in `$.app`; with `nested` the
 * row template is a panel whose child `open` is the button
 */
function mountRows(on: unknown, renderAt: string = SLOT, nested = false): Fixture {
    const row = nested ? { component: 'panel', children: { open: { component: 'button', on } } } : { component: 'button', on };
    setNodeResolver((name) => tags[name]);
    const store = createStore<unknown>({
        app: { component: 'panel', children: { orders: { component: 'records', row } } },
        data: { orders: { k1: { id: 'k1', customer: 'Ada' }, k2: { id: 'k2', customer: 'Grace' } }, selected: '' },
        runtime: { nodes: { app: { children: { orders: { slots: { 3: structuredClone(row) } } } } } }
    });
    store.link(`${SLOT}.row`, '$.data.orders.k1');
    if (renderAt !== SLOT) store.link(`${OWNER}.slots`, '$.runtime.nodes.app.children.orders.slots');
    const host = document.body.appendChild(document.createElement('div'));
    mount(host, store);
    for (const path of ['$.app', renderAt]) host.appendChild(document.createElement('sui-node')).setAttribute('state', path);
    const onError = vi.fn();
    createDispatcher({ host, store, library, hooks: { onError } });
    const button = find(host, nested ? `${renderAt}.children.open` : renderAt);
    const owner = find(host, OWNER);
    if (!button || !owner) throw new Error('fixture did not render');
    return { store, button, owner, onError };
}

describe('$row and relative targets in a row template in Chromium', () => {
    beforeEach(() => {
        vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        setNodeResolver(undefined);
        vi.restoreAllMocks();
        for (const host of Array.from(document.body.children)) unmount(host);
        document.body.replaceChildren();
    });

    it('should write the field of the record the slot shows and follow a re-pointed row', () => {
        // Arrange
        const { store, button } = mountRows({ press: { command: 'set', target: '$.data.selected', value: '$row.id' } });

        // Act
        raise(button, 'press');
        const first = store.get('$.data.selected');
        store.link(`${SLOT}.row`, '$.data.orders.k2');
        raise(button, 'press');

        // Assert
        expect(first).toBe('k1');
        expect(store.get('$.data.selected')).toBe('k2');
    });

    it('should find the slot when it is rendered through its alias in $.app', () => {
        // Arrange
        const { store, button } = mountRows(
            { press: { command: 'set', target: '$.data.selected', value: '$row.id' } },
            `${OWNER}.slots.3`
        );

        // Act
        raise(button, 'press');
        const first = store.get('$.data.selected');
        store.link(`${SLOT}.row`, '$.data.orders.k2');
        raise(button, 'press');

        // Assert
        expect(first).toBe('k1');
        expect(store.get('$.data.selected')).toBe('k2');
    });

    it('should find the row of a node nested in a slot rendered through its alias', () => {
        // Arrange
        const { store, button, onError } = mountRows(
            { press: { command: 'set', target: '$.data.selected', value: '$row.id' } },
            `${OWNER}.slots.3`,
            true
        );

        // Act
        raise(button, 'press');
        const first = store.get('$.data.selected');
        store.link(`${SLOT}.row`, '$.data.orders.k2');
        raise(button, 'press');

        // Assert
        expect(onError).not.toHaveBeenCalled();
        expect(first).toBe('k1');
        expect(store.get('$.data.selected')).toBe('k2');
    });

    it('should write through $row to the record itself', () => {
        // Arrange
        const { store, button } = mountRows({ press: { command: 'set', target: '$row.customer', value: 'Linus' } });

        // Act
        raise(button, 'press');

        // Assert
        expect(store.get('$.data.orders.k1.customer')).toBe('Linus');
    });

    it('should hand a command aimed at $row to the node that owns the template, with the record path', () => {
        // Arrange
        const { owner, button, onError } = mountRows({ press: { command: 'delete', target: '$row', value: 'now' } });
        const remove = vi.fn();
        (owner as CommandElement).commands = { delete: remove };

        // Act
        raise(button, 'press');

        // Assert
        expect(remove).toHaveBeenCalledWith('now', null, `${SLOT}.row`);
        expect(onError).not.toHaveBeenCalled();
    });

    it('should resolve a relative target against the owning node, not the slot', () => {
        // Arrange
        const { store, button, onError } = mountRows({
            press: [
                { command: 'set', target: '.picked', value: 'own' },
                { command: 'set', target: '^orders.picked', value: 'named' }
            ]
        });

        // Act
        raise(button, 'press');

        // Assert
        expect(store.get(`${OWNER}.picked`)).toBe('named');
        expect(store.get(`${SLOT}.picked`)).toBeUndefined();
        expect(onError).not.toHaveBeenCalled();
    });

    it('should report $row used outside a row template', () => {
        // Arrange
        setNodeResolver((name) => tags[name]);
        const store = createStore<unknown>({
            app: {
                component: 'panel',
                children: { b: { component: 'button', on: { press: { command: 'set', target: '$row.x', value: 1 } } } }
            }
        });
        const host = document.body.appendChild(document.createElement('div'));
        mount(host, store);
        host.appendChild(document.createElement('sui-node')).setAttribute('state', '$.app');
        const onError = vi.fn();
        createDispatcher({ host, store, library, hooks: { onError } });

        // Act
        raise(find(host, '$.app.children.b') as HTMLElement, 'press');

        // Assert
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: 'SUI-RUN-ON-TARGET', statePath: '$.app.children.b' });
    });
});
