import { addListener, clearListeners, getCategories, report, setCategories } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { Shape } from '../../core/shape/index.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from './index.js';
import { REPORT_STORAGE_KEY } from './reporting.js';

/** A value no report may hold */
const SECRET = 'secret-value-91c2';

function shapeOf(properties: Record<string, unknown>, events: string[] = [], layout = false): Shape {
    const result = parseShape({ summary: 'Fixture', properties, events, ...(layout && { layout }) }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const library: ComponentLibrary = Object.freeze({
    panel: { tier: 'root', tag: 'x-rep-panel', shape: shapeOf({ children: { type: 'map', items: 'string', default: {} } }) },
    label: { tier: 'root', tag: 'x-rep-label', shape: shapeOf({ text: { type: 'string', default: '' } }) },
    button: { tier: 'root', tag: 'x-rep-button', shape: shapeOf({}, ['press']) },
    app: { tier: 'root', tag: 'x-rep-app', shape: shapeOf({ toasts: { type: 'node' } }, [], true) }
});

defineComponent({
    tag: 'x-rep-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-rep-label', template: '<p>{{ $.text }}</p>' });
defineComponent({ tag: 'x-rep-button', template: '<b>button</b>' });
defineComponent({ tag: 'x-rep-app', template: '<section layout-host=""></section><sui-node state=".toasts"></sui-node>' });

function documentOf(): AppDocument {
    return JSON.parse(
        JSON.stringify({
            app: { component: 'app', layout: { type: 'column' } },
            screens: {
                home: {
                    title: 'Home',
                    root: {
                        component: 'panel',
                        children: {
                            open: { component: 'button', on: { press: { command: 'navigate', target: 'other' } } },
                            greeting: { component: 'label', '<-text': '$.data.name' }
                        }
                    }
                },
                other: { title: 'Other', root: { component: 'panel', children: { note: { component: 'label', text: 'Other' } } } }
            },
            start: 'home',
            data: { name: SECRET }
        })
    ) as AppDocument;
}

/** The first element with `tag` below `root`, crossing shadow roots */
function find(root: ParentNode, tag: string): Element | undefined {
    for (const candidate of Array.from(root.querySelectorAll('*'))) {
        if (candidate.localName === tag) return candidate;
        const inner = candidate.shadowRoot ? find(candidate.shadowRoot, tag) : undefined;
        if (inner) return inner;
    }
    return undefined;
}

describe('reporting in the browser', () => {
    afterEach(() => {
        setCategories(['info', 'error', 'stack']);
        clearListeners();
        localStorage.removeItem(REPORT_STORAGE_KEY);
        vi.restoreAllMocks();
        document.body.replaceChildren();
    });

    it('should turn on the categories localStorage lists at the first mount, log them to the console, and report the app by name only', async () => {
        // Arrange
        vi.spyOn(report, 'error').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        localStorage.setItem(REPORT_STORAGE_KEY, ' stateui-app.mount, stateui-app.command ,');
        const seen: { category: string; message: string; details: Record<string, unknown> }[] = [];
        addListener((_timestamp, category, message, details) => seen.push({ category, message, details: details as Record<string, unknown> }), ['stateui-app.*']);
        const host = document.body.appendChild(document.createElement('div'));

        // Act
        const app = mountApp(host, documentOf(), library);
        (find(host, 'x-rep-button') as Element).dispatchEvent(new CustomEvent('press', { bubbles: true, composed: true }));
        app.dispose();
        localStorage.setItem(REPORT_STORAGE_KEY, 'stateui-app.logic.*');
        mountApp(document.body.appendChild(document.createElement('div')), documentOf(), library).dispose();
        await Promise.resolve();

        // Assert
        expect(getCategories()).toEqual(['info', 'error', 'stack', 'stateui-app.mount', 'stateui-app.command']);
        const first = seen.slice(0, seen.findIndex((entry) => entry.message === 'App unmounted') + 1);
        expect(first.map((entry) => [entry.category, entry.message])).toEqual([
            ['stateui-app.mount', 'Theme applied'],
            ['stateui-app.mount', 'Screen shown'],
            ['stateui-app.mount', 'App mounted'],
            ['stateui-app.mount', 'Screen changed'],
            ['stateui-app.command', 'Commands ran'],
            ['stateui-app.mount', 'App unmounted']
        ]);
        expect(first[2]?.details).toEqual({ mode: 'standalone', screens: 2, steps: expect.any(Number), links: 1, warnings: 0, functions: 'ready', ms: expect.any(Number) });
        expect(first[4]?.details).toEqual({ event: 'press', path: '$.screens.home.children.open', commands: ['navigate'] });
        expect(first[3]?.details).toEqual({ screen: 'other', from: 'home' });
        expect(log).toHaveBeenCalledWith(expect.stringContaining('stateui-app.mount'));
        expect(JSON.stringify(seen)).not.toContain(SECRET);
        expect(log.mock.calls.flat().join('\n')).not.toContain(SECRET);
    });
});
