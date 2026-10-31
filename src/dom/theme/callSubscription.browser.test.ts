import { createStore } from '@punyts/state';
import { defineComponent, mount, unmount } from '@punyts/stateui';
import { afterEach, describe, expect, it } from 'vitest';

interface GateState {
    a: { b: string };
    other: string;
}

const calls: string[] = [];

defineComponent({
    tag: 'x-gate-probe',
    template: '<span>{{ $.a.b }}</span>',
    styles: ':host { --gate-value: {{ probe($.a.b) }}; }',
    controller: () => ({
        probe: (value: string) => {
            calls.push(value);
            return `v-${value}`;
        }
    })
});

describe('decision gate: a function call over a store path in a style binding', () => {
    let host: HTMLElement | undefined;

    afterEach(() => {
        if (host) unmount(host);
        host?.remove();
        host = undefined;
        calls.length = 0;
    });

    function setup(): { store: ReturnType<typeof createStore<GateState>>; element: HTMLElement } {
        const store = createStore<GateState>({ a: { b: 'one' }, other: 'x' });
        host = document.body.appendChild(document.createElement('div'));
        mount(host, store);
        const element = host.appendChild(document.createElement('x-gate-probe'));
        return { store, element };
    }

    it('should re-run the call and rewrite the custom property when the path it reads changes', () => {
        // Arrange
        const { store, element } = setup();

        // Act
        store.set('$.a.b', 'two');

        // Assert
        expect(calls).toEqual(['one', 'two']);
        const written = Array.from(element.style).map((name) => element.style.getPropertyValue(name));
        expect(written).toContain('v-two');
    });

    it('should not re-run the call when an unrelated path changes', () => {
        // Arrange
        const { store } = setup();

        // Act
        store.set('$.other', 'y');

        // Assert
        expect(calls).toEqual(['one']);
    });

    it('should re-run the call with the new value when an ancestor of the path is replaced', () => {
        // Arrange
        const { store, element } = setup();

        // Act
        store.set('$.a', { b: 'three' });

        // Assert
        expect(calls[0]).toBe('one');
        expect(new Set(calls.slice(1))).toEqual(new Set(['three']));
        const written = Array.from(element.style).map((name) => element.style.getPropertyValue(name));
        expect(written).toContain('v-three');
    });
});
