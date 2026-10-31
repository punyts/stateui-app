import { defineComponent } from '@punyts/stateui';
import { afterEach, describe, expect, it } from 'vitest';
import { extractLinks } from '../../core/links/index.js';
import { validateLocaleOverlay } from '../../core/locale/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { cloneJson, resolveNode } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { Shape } from '../../core/shape/index.js';
import type { AppDocument, JsonObject, Node } from '../../core/types.js';
import { mountApp } from '../mount/index.js';
import type { MountedApp } from '../mount/index.js';
import { switchLocale } from './index.js';

function shapeOf(properties: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Fixture', properties }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const content = { type: 'string', kind: 'content', default: '' };

const library: ComponentLibrary = {
    panel: { tier: 'root', tag: 'x-loc-panel', shape: shapeOf({ children: { type: 'map', items: 'string', default: {} } }) },
    heading: { tier: 'root', tag: 'x-loc-heading', shape: shapeOf({ _text: content }) },
    select: {
        tier: 'root',
        tag: 'x-loc-select',
        shape: shapeOf({ options: { type: 'map', items: { _label: content, value: { type: 'string', default: '' } }, default: {} } })
    },
    table: {
        tier: 'root',
        tag: 'x-loc-table',
        shape: shapeOf({ columns: { type: 'map', items: { _title: content, field: { type: 'string', default: '' } }, default: {} } })
    }
};

defineComponent({
    tag: 'x-loc-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-loc-heading', template: '<h1>{{ $._text }}</h1>' });
defineComponent({ tag: 'x-loc-select', template: '<ul><li repeat="{{ $k,$i,$o in $.options }}" key="{{ $k }}">{{ $o._label }}</li></ul>' });
defineComponent({ tag: 'x-loc-table', template: '<ol><li repeat="{{ $k,$i,$c in $.columns }}" key="{{ $k }}">{{ $c._title }}</li></ol>' });

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

const documentOf = (): AppDocument => ({
    locale: 'en',
    data: { typed: 'Ada', premium: 'Premium' },
    theme: { tokens: { color: { accent: { base: '#ff0000' } } }, active: {} },
    app: {
        component: 'panel',
        children: {
            title: { component: 'heading', _text: 'Orders' },
            note: { component: 'heading', '<-_text': '$.data.premium' },
            pick: {
                component: 'select',
                options: {
                    basic: { _label: 'Basic', value: 'basic' },
                    premium: { _label: 'Premium', value: 'premium' }
                }
            },
            list: { component: 'table', columns: { customer: { _title: 'Customer', field: 'customer' } } }
        }
    } as Node
});

const DE: JsonObject = {
    children: {
        title: { _text: 'Aufträge' },
        pick: { options: { basic: { _label: 'Einfach' } } },
        list: { columns: { customer: { _title: 'Kunde' } } }
    }
};

describe('switching language in Chromium', () => {
    const apps: MountedApp[] = [];

    afterEach(() => {
        for (const app of apps.splice(0)) app.dispose();
        document.body.replaceChildren();
    });

    it('should switch to German and back with data and theme untouched, and leave a linked option alone', async () => {
        // Arrange
        const host = document.body.appendChild(document.createElement('div'));
        const doc = documentOf();
        const resolved = resolveNode(cloneJson(doc.app as unknown as JsonObject) as Node, library, doc.composed);
        const extracted = extractLinks(resolved.node, { library, instances: resolved.instances });
        const overlayErrors = validateLocaleOverlay('de', DE, extracted.tree, { library, linkedPaths: extracted.linkedPaths });
        const app = mountApp(host, doc, library);
        apps.push(app);
        const store = app.store;
        const overlays = { [app.baseLocale ?? '']: app.baseOverlay ?? {}, de: DE };
        store?.set('$.data.typed', 'Grace');
        const themeBefore: unknown = JSON.parse(JSON.stringify(store?.get('$.theme')));

        // Act
        const before = textOf(host);
        const germanErrors = switchLocale(store!, 'de', overlays);
        const german = textOf(host);
        const dataInGerman = store?.get('$.data.typed');
        store?.set('$.data.premium', 'Premium plus');
        const linkedChanged = textOf(host);
        const englishErrors = switchLocale(store!, 'en', overlays);
        const english = textOf(host);

        // Assert
        expect(overlayErrors).toEqual([]);
        expect(app.errors).toEqual([]);
        expect(germanErrors).toEqual([]);
        expect(englishErrors).toEqual([]);
        expect(before).toContain('Orders');
        expect(before).toContain('Basic');
        expect(before).toContain('Customer');
        expect(german).toContain('Aufträge');
        expect(german).toContain('Einfach');
        expect(german).toContain('Kunde');
        expect(german).not.toContain('Customer');
        expect(german).toContain('Premium');
        expect(linkedChanged).toContain('Premium plus');
        expect(english).toContain('Orders');
        expect(english).toContain('Basic');
        expect(english).toContain('Customer');
        expect(english).toContain('Premium plus');
        expect(dataInGerman).toBe('Grace');
        expect(store?.get('$.data.typed')).toBe('Grace');
        expect(store?.get('$.theme')).toEqual(themeBefore);
        expect(store?.get('$.locale')).toBe('en');
    });

    it('should keep the base overlay without linked properties', () => {
        // Arrange
        const host = document.body.appendChild(document.createElement('div'));

        // Act
        const app = mountApp(host, documentOf(), library);
        apps.push(app);

        // Assert
        expect(app.baseLocale).toBe('en');
        expect(JSON.stringify(app.baseOverlay)).toContain('Basic');
        expect(JSON.stringify(app.baseOverlay)).not.toContain('"note"');
    });

    it('should return no overlay for an app that did not start', () => {
        // Arrange
        const host = document.body.appendChild(document.createElement('div'));
        const doc: AppDocument = { app: { component: 'ghost' } };

        // Act
        const app = mountApp(host, doc, library);

        // Assert
        expect(app.store).toBeUndefined();
        expect(app.baseOverlay).toBeUndefined();
        expect(app.baseLocale).toBeUndefined();
    });
});
