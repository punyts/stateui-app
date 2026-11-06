import { report } from '@punyts/core';
import { createStore } from '@punyts/state';
import type { Store } from '@punyts/state';
import { defineComponent, mount, setNodeResolver, unmount } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildError } from '../../core/errors/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { Shape } from '../../core/shape/index.js';
import { createDispatcher } from './index.js';
import type { CommandElement, Dispatcher } from './index.js';

function shapeOf(properties: Record<string, unknown>, events: string[], commands: string[]): Shape {
    const result = parseShape({ summary: 'Fixture', properties, events, commands }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const library: ComponentLibrary = {
    panel: {
        tier: 'root',
        tag: 'x-on-panel',
        shape: shapeOf({ children: { type: 'map', items: 'string', default: {} } }, [], [])
    },
    button: {
        tier: 'root',
        tag: 'x-on-button',
        shape: shapeOf({ enabled: { type: 'boolean', default: true } }, ['press'], [])
    },
    dialog: {
        tier: 'root',
        tag: 'x-on-dialog',
        shape: shapeOf({ open: { type: 'boolean', default: true }, children: { type: 'map', items: 'string', default: {} } }, ['close'], ['close', 'select'])
    }
};

defineComponent({
    tag: 'x-on-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-on-button', template: '<b>button</b>' });
defineComponent({
    tag: 'x-on-dialog',
    template: '<i>dialog</i><sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});

interface Fixture {
    store: Store<unknown>;
    host: HTMLElement;
    hooks: { onEmit: ReturnType<typeof vi.fn>; onError: ReturnType<typeof vi.fn> };
    dispatcher: Dispatcher;
    element(path: string): HTMLElement;
}

const tags: Record<string, string> = { panel: 'x-on-panel', button: 'x-on-button', dialog: 'x-on-dialog' };

function mountApp(app: unknown, data: unknown = {}): Fixture {
    setNodeResolver((name) => tags[name]);
    const store = createStore<unknown>({ app, data });
    const host = document.body.appendChild(document.createElement('div'));
    mount(host, store);
    const root = host.appendChild(document.createElement('sui-node'));
    root.setAttribute('state', '$.app');
    const hooks = { onEmit: vi.fn(), onError: vi.fn() };
    const dispatcher = createDispatcher({ host, store, library, hooks });
    const element = (path: string): HTMLElement => {
        const found = find(host, path);
        if (!found) throw new Error(`no element at ${path}`);
        return found;
    };
    return { store, host, hooks, dispatcher, element };
}

function find(root: ParentNode, path: string): HTMLElement | undefined {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        const scope = (candidate as { scope?: { basePath?: string } }).scope;
        if (scope?.basePath === path && candidate.localName.startsWith('x-on-')) return candidate as HTMLElement;
        const inner = candidate.shadowRoot ? find(candidate.shadowRoot, path) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

function raise(element: Element, name: string, detail?: unknown): void {
    element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

const panel = (children: Record<string, unknown>) => ({ component: 'panel', children });

describe('on dispatch in Chromium', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        setNodeResolver(undefined);
        errorSpy.mockRestore();
        for (const host of Array.from(document.body.children)) unmount(host);
        document.body.replaceChildren();
    });

    it('should run set when press is raised and change the store', () => {
        // Arrange
        const { store, element } = mountApp(
            panel({ save: { component: 'button', on: { press: { command: 'set', target: '$.data.saved', value: true } } } }),
            { saved: false }
        );

        // Act
        raise(element('$.app.children.save'), 'press');

        // Assert
        expect(store.get('$.data.saved')).toBe(true);
    });

    it('should set a property of the node itself through an own-subtree target', () => {
        // Arrange
        const { store, element } = mountApp(
            panel({ b: { component: 'button', enabled: true, on: { press: { command: 'set', target: '.enabled', value: false } } } })
        );

        // Act
        raise(element('$.app.children.b'), 'press');

        // Assert
        expect(store.get('$.app.children.b.enabled')).toBe(false);
    });

    it('should copy the value at from with set, a copy that later writes do not change', () => {
        // Arrange
        const { store, element } = mountApp(
            panel({
                b: { component: 'button', on: { press: [{ command: 'set', target: '$.data.chosen', from: '$.data.colors.blue' }, { command: 'set', target: '.enabled', from: '$.data.flag' }] } }
            }),
            { colors: { blue: { hex: '#00f' } }, flag: false }
        );

        // Act
        raise(element('$.app.children.b'), 'press');
        store.set('$.data.colors.blue.hex', '#11f' as never);

        // Assert
        expect(store.get('$.data.chosen')).toEqual({ hex: '#00f' });
        expect(store.get('$.app.children.b.enabled')).toBe(false);
    });

    it('should fail a set whose from has no value and write nothing', () => {
        // Arrange
        const { store, hooks, element } = mountApp(
            panel({ b: { component: 'button', on: { press: { command: 'set', target: '$.data.chosen', from: '$.data.missing' } } } }),
            { chosen: 'old' }
        );

        // Act
        raise(element('$.app.children.b'), 'press');

        // Assert
        expect(store.get('$.data.chosen')).toBe('old');
        expect(hooks.onError).toHaveBeenCalled();
    });

    it('should emit the value at from as the payload', () => {
        // Arrange
        const { hooks, element } = mountApp(panel({ b: { component: 'button', on: { press: { command: 'emit', target: 'picked', from: '$.data.pick' } } } }), { pick: 'k2' });

        // Act
        raise(element('$.app.children.b'), 'press');

        // Assert
        expect(hooks.onEmit).toHaveBeenCalledWith('picked', 'k2');
    });

    it('should run a list in order', () => {
        // Arrange
        const { store, element } = mountApp(
            panel({
                b: {
                    component: 'button',
                    on: {
                        press: [
                            { command: 'set', target: '$.data.step', value: 'one' },
                            { command: 'set', target: '$.data.step', value: 'two' }
                        ]
                    }
                }
            }),
            { step: '' }
        );

        // Act
        raise(element('$.app.children.b'), 'press');

        // Assert
        expect(store.get('$.data.step')).toBe('two');
    });

    it('should stop the list at a failing command, report SUI-RUN with the state path and skip the rest', () => {
        // Arrange
        const { store, element, hooks } = mountApp(
            panel({
                b: {
                    component: 'button',
                    on: {
                        press: [
                            { command: 'set', target: '^nobody.enabled', value: false },
                            { command: 'set', target: '$.data.step', value: 'ran' }
                        ]
                    }
                }
            }),
            { step: 'untouched' }
        );

        // Act
        raise(element('$.app.children.b'), 'press');

        // Assert
        expect(store.get('$.data.step')).toBe('untouched');
        expect(hooks.onError).toHaveBeenCalledTimes(1);
        const error = hooks.onError.mock.calls[0]?.[0] as BuildError;
        expect(error.code).toBe('SUI-RUN-ON-TARGET');
        expect(error.statePath).toBe('$.app.children.b');
        expect(errorSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ state: '$.app.children.b' }));
    });

    it('should report an unresolved target at runtime and do nothing else', () => {
        // Arrange
        const { store, element, hooks } = mountApp(
            panel({ b: { component: 'button', on: { press: { command: 'toggle', target: '.missing' } } } }),
            { flag: false }
        );

        // Act
        raise(element('$.app.children.b'), 'press');

        // Assert
        expect(hooks.onError).toHaveBeenCalledTimes(1);
        expect((hooks.onError.mock.calls[0]?.[0] as BuildError).code).toBe('SUI-RUN-ON-TARGET');
        expect(store.get('$.data.flag')).toBe(false);
    });

    it('should send the event payload to onEmit when emit has no value', () => {
        // Arrange
        const { element, hooks } = mountApp(
            panel({ b: { component: 'button', on: { press: { command: 'emit', target: 'saved' } } } })
        );

        // Act
        raise(element('$.app.children.b'), 'press', { id: 7 });

        // Assert
        expect(hooks.onEmit).toHaveBeenCalledWith('saved', { id: 7 });
    });

    it('should send the command value to onEmit when emit has one', () => {
        // Arrange
        const { element, hooks } = mountApp(
            panel({ b: { component: 'button', on: { press: { command: 'emit', target: 'saved', value: 'fixed' } } } })
        );

        // Act
        raise(element('$.app.children.b'), 'press', { id: 7 });

        // Assert
        expect(hooks.onEmit).toHaveBeenCalledWith('saved', 'fixed');
    });

    it('should flip a boolean with toggle and fail on a value that is not a boolean', () => {
        // Arrange
        const { store, element, hooks } = mountApp(
            panel({
                b: { component: 'button', on: { press: { command: 'toggle', target: '$.data.flag' } } },
                c: { component: 'button', on: { press: { command: 'toggle', target: '$.data.name' } } }
            }),
            { flag: false, name: 'x' }
        );

        // Act
        raise(element('$.app.children.b'), 'press');
        raise(element('$.app.children.b'), 'press');
        raise(element('$.app.children.b'), 'press');
        raise(element('$.app.children.c'), 'press');

        // Assert
        expect(store.get('$.data.flag')).toBe(true);
        expect(store.get('$.data.name')).toBe('x');
        expect(hooks.onError).toHaveBeenCalledTimes(1);
    });

    it('should reach the target element through its commands object', () => {
        // Arrange
        const { element, hooks } = mountApp(
            panel({
                dlg: { component: 'dialog' },
                b: { component: 'button', on: { press: { command: 'close', target: '$.app.children.dlg', value: 'now' } } }
            })
        );
        const close = vi.fn();
        (element('$.app.children.dlg') as CommandElement).commands = { close };

        // Act
        raise(element('$.app.children.b'), 'press', 'payload');

        // Assert
        expect(close).toHaveBeenCalledWith('now', 'payload');
        expect(hooks.onError).not.toHaveBeenCalled();
    });

    it('should run a component command on the node itself when it has no target', () => {
        // Arrange
        const { element } = mountApp(panel({ dlg: { component: 'dialog', on: { close: { command: 'close' } } } }));
        const close = vi.fn();
        const dialog = element('$.app.children.dlg') as CommandElement;
        dialog.commands = { close };

        // Act
        raise(dialog, 'close');

        // Assert
        expect(close).toHaveBeenCalledWith(undefined, null);
    });

    it('should find the nearest provider for $parent', () => {
        // Arrange
        const { element } = mountApp({
            component: 'dialog',
            children: { b: { component: 'button', on: { press: { command: 'close', target: '$parent' } } } }
        });
        const close = vi.fn();
        (element('$.app') as CommandElement).commands = { close };

        // Act
        raise(element('$.app.children.b'), 'press');

        // Assert
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('should report a component command the element does not handle or throws from', () => {
        // Arrange
        const { element, hooks } = mountApp(
            panel({
                dlg: { component: 'dialog' },
                b: { component: 'button', on: { press: [{ command: 'close', target: '$.app.children.dlg' }, { command: 'emit', target: 'after' }] } }
            })
        );

        // Act
        raise(element('$.app.children.b'), 'press');
        (element('$.app.children.dlg') as CommandElement).commands = {
            close: () => {
                throw new Error('boom');
            }
        };
        raise(element('$.app.children.b'), 'press');

        // Assert
        expect(hooks.onError).toHaveBeenCalledTimes(2);
        expect(hooks.onEmit).not.toHaveBeenCalled();
    });

    it('should ignore an event the node does not map', () => {
        // Arrange
        const { store, element, hooks } = mountApp(
            panel({ dlg: { component: 'dialog', on: { close: { command: 'set', target: '$.data.x', value: 1 } } } }),
            { x: 0 }
        );

        // Act
        raise(element('$.app.children.dlg'), 'select');

        // Assert
        expect(store.get('$.data.x')).toBe(0);
        expect(hooks.onError).not.toHaveBeenCalled();
    });

    it('should release the handlers of a removed node', () => {
        // Arrange
        const { store, element, host } = mountApp(
            panel({ b: { component: 'button', on: { press: { command: 'set', target: '$.data.x', value: 1 } } } }),
            { x: 0 }
        );
        const button = element('$.app.children.b');

        // Act
        store.delete('$.app.children.b');
        raise(button, 'press');

        // Assert
        expect(button.isConnected).toBe(false);
        expect(host.contains(button)).toBe(false);
        expect(store.get('$.data.x')).toBe(0);
    });

    it('should stop dispatching after dispose', () => {
        // Arrange
        const { store, element, dispatcher } = mountApp(
            panel({ b: { component: 'button', on: { press: { command: 'set', target: '$.data.x', value: 1 } } } }),
            { x: 0 }
        );
        const button = element('$.app.children.b');

        // Act
        dispatcher.dispose();
        dispatcher.dispose();
        raise(button, 'press');

        // Assert
        expect(store.get('$.data.x')).toBe(0);
    });
});

describe('ui-file-transfer in Chromium', () => {
    const reference = { id: 'f1', name: 'a.txt', size: 1, type: 'text/plain' };

    afterEach(() => {
        setNodeResolver(undefined);
        for (const host of Array.from(document.body.children)) unmount(host);
        document.body.replaceChildren();
    });

    function request(onProgress?: () => void, signal?: AbortSignal) {
        const respond = vi.fn<(result: Promise<unknown>) => void>();
        const file = new File(['a'], 'a.txt', { type: 'text/plain' });
        const detail = { file, respond, ...(onProgress ? { onProgress } : {}), ...(signal ? { signal } : {}) };
        return { respond, file, detail };
    }

    it('should hand the file, the progress callback and the signal to hooks.transferFile and respond with its promise', async () => {
        // Arrange
        const { host, hooks, element } = mountApp(panel({ b: { component: 'button' } }));
        const transferFile = vi.fn(() => Promise.resolve(reference));
        const dispatcher = createDispatcher({ host, store: createStore<unknown>({ app: {} }), library, hooks: { ...hooks, transferFile } });
        const onProgress = vi.fn();
        const controller = new AbortController();
        const { respond, file, detail } = request(onProgress, controller.signal);

        // Act
        raise(element('$.app.children.b'), 'ui-file-transfer', detail);

        // Assert
        expect(transferFile).toHaveBeenCalledWith(file, { onProgress, signal: controller.signal });
        expect(respond).toHaveBeenCalledTimes(1);
        await expect(respond.mock.calls[0]?.[0]).resolves.toEqual(reference);
        dispatcher.dispose();
    });

    it('should leave the request unanswered when the host gives no transferFile hook', () => {
        // Arrange
        const { element } = mountApp(panel({ b: { component: 'button' } }));
        const { respond, detail } = request();

        // Act
        raise(element('$.app.children.b'), 'ui-file-transfer', detail);

        // Assert
        expect(respond).not.toHaveBeenCalled();
    });

    it('should ignore a detail that is not a file request and stop listening after dispose', () => {
        // Arrange
        const { host, element, dispatcher } = mountApp(panel({ b: { component: 'button' } }));
        const transferFile = vi.fn(() => Promise.resolve(reference));
        const second = createDispatcher({ host, store: createStore<unknown>({ app: {} }), library, hooks: { transferFile } });
        const { respond, detail } = request();

        // Act
        raise(element('$.app.children.b'), 'ui-file-transfer', { file: 'no', respond });
        second.dispose();
        raise(element('$.app.children.b'), 'ui-file-transfer', detail);

        // Assert
        expect(transferFile).not.toHaveBeenCalled();
        expect(respond).not.toHaveBeenCalled();
        dispatcher.dispose();
    });
});

describe('ui-file-read in Chromium', () => {
    const read = { file: { id: 'f1', name: 'a.png', size: 1, type: 'image/png' }, data: new ArrayBuffer(1) };

    afterEach(() => {
        setNodeResolver(undefined);
        for (const host of Array.from(document.body.children)) unmount(host);
        document.body.replaceChildren();
    });

    function request(id: unknown, signal?: AbortSignal) {
        const respond = vi.fn<(result: Promise<unknown>) => void>();
        const detail = { id, respond, ...(signal ? { signal } : {}) };
        return { respond, detail };
    }

    it('should hand the id and the signal to hooks.readFile and respond with its promise', async () => {
        // Arrange
        const { host, hooks, element } = mountApp(panel({ b: { component: 'button' } }));
        const readFile = vi.fn(() => Promise.resolve(read));
        const dispatcher = createDispatcher({ host, store: createStore<unknown>({ app: {} }), library, hooks: { ...hooks, readFile } });
        const controller = new AbortController();
        const { respond, detail } = request('f1', controller.signal);

        // Act
        raise(element('$.app.children.b'), 'ui-file-read', detail);

        // Assert
        expect(readFile).toHaveBeenCalledWith('f1', { signal: controller.signal });
        expect(respond).toHaveBeenCalledTimes(1);
        await expect(respond.mock.calls[0]?.[0]).resolves.toEqual(read);
        dispatcher.dispose();
    });

    it('should leave the request unanswered when the host gives no readFile hook', () => {
        // Arrange
        const { element } = mountApp(panel({ b: { component: 'button' } }));
        const { respond, detail } = request('f1');

        // Act
        raise(element('$.app.children.b'), 'ui-file-read', detail);

        // Assert
        expect(respond).not.toHaveBeenCalled();
    });

    it('should ignore a detail that is not a read request and stop listening after dispose', () => {
        // Arrange
        const { host, element, dispatcher } = mountApp(panel({ b: { component: 'button' } }));
        const readFile = vi.fn(() => Promise.resolve(read));
        const second = createDispatcher({ host, store: createStore<unknown>({ app: {} }), library, hooks: { readFile } });
        const { respond, detail } = request('f1');

        // Act
        raise(element('$.app.children.b'), 'ui-file-read', request(5).detail);
        raise(element('$.app.children.b'), 'ui-file-read', request('').detail);
        second.dispose();
        raise(element('$.app.children.b'), 'ui-file-read', detail);

        // Assert
        expect(readFile).not.toHaveBeenCalled();
        expect(respond).not.toHaveBeenCalled();
        dispatcher.dispose();
    });
});
