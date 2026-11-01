import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { applyLinks, runtimePath, resolveRowLinks } from '../../core/index.js';
import { parseShape } from '../../core/shape/index.js';
import { DEFAULT_TOKENS } from '../../core/theme/index.js';
import type { Shape } from '../../core/shape/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp, registerMountStep } from './index.js';
import type { MountedApp } from './index.js';

function shapeOf(properties: Record<string, unknown>, events: string[] = []): Shape {
    const result = parseShape({ summary: 'Fixture', properties, events }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const library: ComponentLibrary = {
    panel: {
        tier: 'root',
        tag: 'x-mount-panel',
        shape: shapeOf({ children: { type: 'map', items: 'string', default: {} } })
    },
    label: {
        tier: 'root',
        tag: 'x-mount-label',
        shape: shapeOf({ text: { type: 'string', default: '' }, mood: { type: 'string', default: 'plain', reflect: true } })
    },
    button: {
        tier: 'root',
        tag: 'x-mount-button',
        shape: shapeOf({ enabled: { type: 'boolean', default: true } }, ['press'])
    },
    records: {
        tier: 'root',
        tag: 'x-mount-records',
        shape: shapeOf({ title: { type: 'string', default: '' }, row: { type: 'node', row: true } })
    },
    rows: {
        tier: 'root',
        tag: 'x-mount-rows',
        shape: shapeOf({ row: { type: 'node', row: true }, slots: { type: 'any', runtime: true, default: {} } })
    },
    shell: {
        tier: 'root',
        tag: 'x-mount-shell',
        shape: shapeOf({ body: { type: 'node' } })
    },
    greeting: {
        tier: 'composed',
        tree: { component: 'label', text: 'Hello' }
    }
};

defineComponent({
    tag: 'x-mount-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-mount-label', template: '<p>{{ $.text }}</p>' });
defineComponent({ tag: 'x-mount-button', template: '<b>button</b>' });
defineComponent({
    tag: 'x-mount-rows',
    template: '<sui-node repeat="{{ $k,$i,$v in $.slots }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-mount-shell', template: '<sui-node state=".body"></sui-node>' });
defineComponent({ tag: 'x-mount-records', template: '<i>{{ $.title }}</i>' });

/** Every text node below `root`, crossing shadow roots */
function textOf(root: ParentNode): string {
    let text = '';
    for (const child of Array.from(root.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
        else if (child instanceof Element) {
            text += child.shadowRoot ? textOf(child.shadowRoot) : '';
            text += textOf(child);
        }
    }
    return text;
}

function find(root: ParentNode, tag: string): Element | undefined {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate;
        const inner = candidate.shadowRoot ? find(candidate.shadowRoot, tag) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

function freshHost(): HTMLElement {
    return document.body.appendChild(document.createElement('div'));
}

const panel = (children: Record<string, unknown>) => ({ component: 'panel', children }) as AppDocument['app'];

describe('mountApp in Chromium', () => {
    const apps: MountedApp[] = [];
    let errorSpy: ReturnType<typeof vi.spyOn>;

    function start(host: Element, doc: AppDocument, hooks = {}): MountedApp {
        const app = mountApp(host, doc, library, hooks);
        apps.push(app);
        return app;
    }

    beforeEach(() => {
        errorSpy = vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        for (const app of apps.splice(0)) app.dispose();
        errorSpy.mockRestore();
        document.body.replaceChildren();
    });

    it('should render the document and change the DOM when state is written', () => {
        // Arrange
        const host = freshHost();
        const doc: AppDocument = {
            data: { name: 'Ada' },
            app: panel({ hello: { component: 'label', '<-text': '$.data.name' }, fixed: { component: 'greeting' } })
        };

        // Act
        const app = start(host, doc);
        const before = textOf(host);
        app.store?.set('$.data.name', 'Grace');

        // Assert
        expect(app.errors).toEqual([]);
        expect(before).toContain('Ada');
        expect(before).toContain('Hello');
        expect(textOf(host)).toContain('Grace');
        expect(host.querySelector('ui-app-root')).not.toBeNull();
    });

    it('should leave the document unchanged', () => {
        // Arrange
        const host = freshHost();
        const doc: AppDocument = { data: { name: 'Ada' }, app: panel({ hello: { component: 'label', '<-text': '$.data.name' } }) };
        const copy = structuredClone(doc);

        // Act
        const app = start(host, doc);
        app.store?.set('$.data.name', 'Grace');

        // Assert
        expect(doc).toEqual(copy);
    });

    it('should create the empty theme, the default locale and the runtime branch', () => {
        // Arrange
        const host = freshHost();

        // Act
        const app = start(host, { app: panel({}) });
        const store = app.store;

        // Assert
        expect(store?.get('$.theme')).toEqual({ tokens: DEFAULT_TOKENS, active: { mode: 'light', brand: 'default', motion: 'full' } });
        expect(store?.get('$.locale')).toBe('en');
        expect(store?.get('$.runtime.nodes')).toEqual({});
        expect(store?.get('$.runtime.icons')).toEqual({});
        expect(store?.get('$.runtime.empty')).toEqual({});
    });

    it('should take the locale from the document and never the runtime branch', () => {
        // Arrange
        const host = freshHost();

        // Act
        const app = start(host, { locale: 'de', app: panel({}), data: {} });

        // Assert
        expect(app.store?.get('$.locale')).toBe('de');
        expect(app.store?.get('$.runtime.nodes')).toEqual({});
    });

    it('should protect the shared empty record', () => {
        // Arrange
        const host = freshHost();
        const app = start(host, { app: panel({}) });

        // Act
        const written = app.store?.set('$.runtime.empty.x', 1);

        // Assert
        expect(written).toBe(false);
        expect(app.store?.get('$.runtime.empty')).toEqual({});
    });

    it('should render nothing and return SUI-NODE-UNKNOWN with the state path for an unknown component', () => {
        // Arrange
        const host = freshHost();
        const doc: AppDocument = { app: panel({ ghost: { component: 'ghost' } }) };

        // Act
        const app = start(host, doc);

        // Assert
        expect(app.store).toBeUndefined();
        expect(app.errors.map((error) => [error.code, error.statePath])).toContainEqual(['SUI-NODE-UNKNOWN', '$.app.children.ghost']);
        expect(host.childNodes).toHaveLength(0);
    });

    it('should change the store when the on.press set command runs', () => {
        // Arrange
        const host = freshHost();
        const doc: AppDocument = {
            data: { saved: false },
            app: panel({ save: { component: 'button', on: { press: { command: 'set', target: '$.data.saved', value: true } } } })
        };
        const app = start(host, doc);
        const button = find(host, 'x-mount-button');

        // Act
        button?.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));

        // Assert
        expect(button).toBeDefined();
        expect(app.store?.get('$.data.saved')).toBe(true);
    });

    it('should write the reflected properties of the shape as attributes', () => {
        // Arrange
        const host = freshHost();

        // Act
        start(host, { app: panel({ hello: { component: 'label', text: 'x', mood: 'danger' } }) });

        // Assert
        expect(find(host, 'x-mount-label')?.getAttribute('mood')).toBe('danger');
    });

    it('should unlink, unmount and leave no state for a second app on a fresh host', () => {
        // Arrange
        const first = freshHost();
        const second = freshHost();
        const one = start(first, { data: { name: 'One' }, app: panel({ hello: { component: 'label', '<-text': '$.data.name' } }) });

        // Act
        one.dispose();
        one.dispose();
        const two = start(second, { data: { name: 'Two' }, app: panel({ hello: { component: 'label', '<-text': '$.data.name' } }) });

        // Assert
        expect(first.querySelector('ui-app-root')).toBeNull();
        expect(textOf(first)).toBe('');
        expect(textOf(second)).toContain('Two');
        expect(two.store?.get('$.data.name')).toBe('Two');
        expect(one.store?.get('$.data.name')).toBe('One');
        one.store?.set('$.data.name', 'Changed');
        expect(textOf(second)).toContain('Two');
    });

    it('should not call the hooks of a disposed app', () => {
        // Arrange
        const host = freshHost();
        const onEmit = vi.fn();
        const app = start(
            host,
            { app: panel({ send: { component: 'button', on: { press: { command: 'emit', target: 'chat.send', value: 1 } } } }) },
            { onEmit }
        );
        const button = find(host, 'x-mount-button');
        app.dispose();

        // Act
        button?.dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));

        // Assert
        expect(onEmit).not.toHaveBeenCalled();
    });

    it('should run registered steps and let them replace the theme and locale', () => {
        // Arrange
        const host = freshHost();
        const dispose = vi.fn();
        const remove = registerMountStep('test', {
            prepare: (context) => {
                context.state.theme = { tokens: { color: { text: 'red' } }, active: { mode: 'dark' } };
                context.state.locale = 'fr';
            },
            start: () => dispose
        });

        // Act
        const app = start(host, { app: panel({}) });
        remove();
        app.dispose();

        // Assert
        expect(app.store?.get('$.theme.active.mode')).toBe('dark');
        expect(app.store?.get('$.locale')).toBe('fr');
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('should stop before rendering when a step throws', () => {
        // Arrange
        const host = freshHost();
        const remove = registerMountStep('broken', {
            prepare: () => {
                throw new Error('nope');
            }
        });

        // Act
        const app = start(host, { app: panel({}) });
        remove();

        // Assert
        expect(app.store).toBeUndefined();
        expect(app.errors.map((error) => error.code)).toEqual(['SUI-RUN-BINDING']);
        expect(host.childNodes).toHaveLength(0);
    });

    it('should keep a $row link of a row template in the tree and apply no link for it', () => {
        // Arrange
        const host = freshHost();
        const doc: AppDocument = {
            data: { name: 'Ada' },
            app: { component: 'records', '<-title': '$.data.name', row: { component: 'label', '<-text': '$row.name' } } as AppDocument['app']
        };

        // Act
        const app = start(host, doc);
        const template = app.store?.get<Record<string, unknown>>('$.app.row');

        // Assert
        expect(app.errors).toEqual([]);
        expect(template?.['<-text']).toBe('$row.name');
        expect(app.store?.get('$.app.title')).toBe('Ada');
    });

    it('should render the rows of a list whose row template has $row links and sits directly in a node slot', () => {
        // Arrange
        const host = freshHost();
        const doc: AppDocument = {
            data: { records: [{ name: 'Ada' }, { name: 'Grace' }, { name: 'Lin' }] },
            app: { component: 'shell', body: { component: 'rows', row: { component: 'label', '<-text': '$row.name' } } } as AppDocument['app']
        };

        // Act
        const remove = registerMountStep('rows', {
            start: ({ store }) => {
                const template = store.get<Record<string, unknown>>('$.app.body.row');
                const pool = `${runtimePath('$.app.body')}.slots`;
                const segments = pool.split('.');
                for (let length = 3; length <= segments.length; length++) {
                    const prefix = segments.slice(0, length).join('.');
                    if (store.get(prefix) === undefined) store.set(prefix, {});
                }
                [0, 1, 2].forEach((index) => {
                    const path = `${pool}.${index}`;
                    const rewritten = resolveRowLinks(template as never, `${path}.row`, { path });
                    store.set(path, rewritten.tree);
                    store.link(`${path}.row`, `$.data.records.${index}`);
                    expect(applyLinks(store, rewritten.links)).toEqual([]);
                });
                store.delete('$.app.body.slots');
                store.link('$.app.body.slots', pool);
            }
        });
        const app = start(host, doc);
        remove();

        // Assert
        expect(app.errors).toEqual([]);
        expect(textOf(host)).toContain('Ada');
        expect(textOf(host)).toContain('Grace');
        expect(textOf(host)).toContain('Lin');
    });
});
