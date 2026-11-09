import { defineComponent } from '@punyts/stateui';
import { afterEach, describe, expect, it } from 'vitest';
import { LOGIC_ORIGIN } from '../../core/logic/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { Shape } from '../../core/shape/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from './index.js';
import type { MountedApp } from './index.js';

function shapeOf(properties: Record<string, unknown>, events: string[] = []): Shape {
    const result = parseShape({ summary: 'Fixture', properties, events }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const library: ComponentLibrary = {
    page: { tier: 'root', tag: 'x-logic-page', shape: shapeOf({ note: { type: 'string', default: '' } }) },
    label: { tier: 'root', tag: 'x-logic-label', shape: shapeOf({ text: { type: 'string', default: '' } }) }
};

defineComponent({
    tag: 'x-logic-page',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-logic-label', template: '<p>{{ $.text }}</p>' });

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function documentWith(logic: Record<string, unknown>, on?: Record<string, unknown>): AppDocument {
    return {
        data: { items: { a: { n: 1 } }, stats: { count: 1 }, qty: 1 },
        app: { component: 'page', ...(on ? { on } : {}), children: { count: { component: 'label', text: '' } } },
        logic
    } as unknown as AppDocument;
}

const COUNT = {
    rules: {
        count: {
            when: { path: '$.data.items' },
            do: [
                { command: 'set', target: '$.data.stats.count', value: '{{ size($.data.items) }}' },
                { command: 'set', target: '^count.text', value: '{{ size($.data.items) }} items' }
            ]
        }
    }
};

describe('browser logic', () => {
    let app: MountedApp | undefined;
    let host: HTMLElement;

    afterEach(() => {
        app?.dispose();
        host?.remove();
        app = undefined;
    });

    function mount(document: AppDocument, mode: 'standalone' | 'persisted' | 'full' = 'standalone'): MountedApp {
        host = document_().body.appendChild(document_().createElement('div'));
        app = mountApp(host, document, library, {}, { mode });
        expect(app.errors.filter((error) => error.severity !== 'warning')).toEqual([]);
        return app;
    }
    const document_ = (): Document => globalThis.document;

    it('should run a rule for the store own writes and tag the logic writes', async () => {
        // Arrange
        const mounted = mount(documentWith(COUNT));
        const origins: (string | undefined)[] = [];
        mounted.store!.on('$.data.stats.count', (_path, _value, _old, _action, origin) => origins.push(origin));

        // Act
        mounted.store!.set('$.data.items.b', { n: 2 });
        await flush();

        // Assert
        expect(mounted.store!.get('$.data.stats.count')).toBe(2);
        expect(mounted.store!.get('$.app.children.count.text')).toBe('2 items');
        expect(origins).toEqual([LOGIC_ORIGIN]);
    });

    it('should run compute units and expression functions the host passes as logicFunctions', async () => {
        // Arrange
        host = document_().body.appendChild(document_().createElement('div'));
        const logic = {
            computes: { double: { inputs: { qty: '$.data.qty' }, run: 'double', outputs: { out: '$.data.stats.count' } } },
            rules: { label: { when: { path: '$.data.stats.count' }, do: [{ command: 'set', target: '^count.text', value: '{{ stars($.data.stats.count) }}' }] } }
        };
        app = mountApp(host, documentWith(logic), library, {}, {
            logicFunctions: {
                compute: { double: ({ qty }) => ({ out: typeof qty === 'number' ? qty * 2 : 0 }) },
                expressions: { stars: (count) => '*'.repeat(Number(count)) }
            }
        });

        // Act
        app.store!.set('$.data.qty', 2);
        await flush();

        // Assert
        expect(app.store!.get('$.data.stats.count')).toBe(4);
        expect(app.store!.get('$.app.children.count.text')).toBe('****');
    });

    it('should skip writes that carry an origin, such as sync writes', async () => {
        const mounted = mount(documentWith(COUNT), 'persisted');

        mounted.store!.set('$.data.items.b', { n: 2 }, { origin: 'sync' });
        await flush();

        expect(mounted.store!.get('$.data.stats.count')).toBe(1);
    });

    it('should run no logic in Full mode', async () => {
        const mounted = mount(documentWith(COUNT), 'full');

        mounted.store!.set('$.data.items.b', { n: 2 });
        await flush();

        expect(mounted.store!.get('$.data.stats.count')).toBe(1);
    });

    it('should undo a change a guard refuses and raise logic.failed on the root', async () => {
        // Arrange
        const logic = {
            rules: { positive: { when: { path: '$.data.qty', if: '$trigger < 0' }, do: [{ command: 'reject', reason: 'No negative quantity' }] } }
        };
        const on = { 'logic.failed': { command: 'set', target: '$.app.note', value: 'refused' } };
        const mounted = mount(documentWith(logic, on));

        // Act
        mounted.store!.set('$.data.qty', -3);
        await flush();

        // Assert
        expect(mounted.store!.get('$.data.qty')).toBe(1);
        expect(mounted.store!.get('$.app.note')).toBe('refused');
    });

    it('should raise notify events on the root node', async () => {
        const logic = { rules: { hello: { when: { path: '$.data.qty' }, do: [{ command: 'notify', target: 'toast', value: { text: 'Changed' } }] } } };
        const on = { 'notify.toast': { command: 'set', target: '$.app.note', value: 'notified' } };
        const mounted = mount(documentWith(logic, on));

        mounted.store!.set('$.data.qty', 5);
        await flush();

        expect(mounted.store!.get('$.app.note')).toBe('notified');
    });

    it('should give a rule the value before the store write as $previous', async () => {
        const logic = { rules: { up: { when: { path: '$.data.qty', was: 1 }, do: [{ command: 'set', target: '$.app.note', value: '{{ $previous }} to {{ $trigger }}' }] } } };
        const mounted = mount(documentWith(logic));

        mounted.store!.set('$.data.qty', 4);
        await flush();

        expect(mounted.store!.get('$.app.note')).toBe('1 to 4');
    });

    it('should fire a debounced rule once after the writes stop, and drop its timer on dispose', async () => {
        // Arrange
        const logic = { rules: { later: { when: { path: '$.data.qty', debounce: 30 }, do: [{ command: 'increment', target: '$.data.stats.count' }] } } };
        const mounted = mount(documentWith(logic));
        const store = mounted.store!;

        // Act
        store.set('$.data.qty', 2);
        await flush();
        store.set('$.data.qty', 3);
        await new Promise((resolve) => setTimeout(resolve, 60));
        const fired = store.get('$.data.stats.count');
        store.set('$.data.qty', 4);
        await flush();
        mounted.dispose();
        app = undefined;
        await new Promise((resolve) => setTimeout(resolve, 60));

        // Assert
        expect(fired).toBe(2);
        expect(store.get('$.data.stats.count')).toBe(2);
    });

    it('should stop when the app is disposed', async () => {
        const mounted = mount(documentWith(COUNT));
        const store = mounted.store!;

        mounted.dispose();
        app = undefined;
        store.set('$.data.items.b', { n: 2 });
        await flush();

        expect(store.get('$.data.stats.count')).toBe(1);
    });
});
