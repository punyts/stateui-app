import { createStore } from '@punyts/state';
import { describe, expect, it } from 'vitest';
import { buildAppOverlay, extractBaseOverlay } from '../../core/locale/index.js';
import type { ComponentOverlays } from '../../core/locale/index.js';
import { cloneJson, resolveNode } from '../../core/resolve/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { Shape } from '../../core/shape/index.js';
import type { JsonObject, Node } from '../../core/types.js';
import { createNodeLocale } from './nodeLocale.js';
import type { NodeLocaleStore } from './nodeLocale.js';
import { switchLocale } from './switchLocale.js';

function shapeOf(properties: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', properties }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const TEXT = { type: 'string', kind: 'content', default: '' };

const LIBRARY: ComponentLibrary = {
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({ _title: TEXT }) },
    text: { tier: 'root', tag: 'ui-text', shape: shapeOf({ _text: { ...TEXT, default: 'Text' } }) },
    select: {
        tier: 'root',
        tag: 'ui-select',
        shape: shapeOf({ options: { type: 'map', items: { _label: TEXT, value: { type: 'string', default: '' } }, default: {} } })
    },
    card: {
        tier: 'composed',
        tree: { component: 'panel', _title: 'Card', children: { body: { component: 'text', _text: 'Body' } } }
    }
};

const COMPONENTS: ComponentOverlays = {
    text: { de: { _text: 'Text (de)' }, fr: { _text: 'Texte' } },
    panel: { de: { _title: 'Titel' } },
    select: { de: { options: { yes: { _label: 'Ja' } } } },
    card: { de: { _title: 'Karte', children: { body: { _text: 'Inhalt' } } } }
};

const OVERRIDES: Record<string, JsonObject> = { de: { children: { special: { _text: 'Besonders' } } } };

const APP: Node = {
    component: 'panel',
    _title: 'Orders',
    children: {
        pick: { component: 'select', options: { no: { _label: 'No', value: 'no' } } }
    }
};

function setup() {
    const resolved = resolveNode(cloneJson(APP as JsonObject) as Node, LIBRARY, {});
    const tree = cloneJson(resolved.node as JsonObject);
    const store = createStore<Record<string, unknown>>({ locale: 'en', app: cloneJson(tree) });
    const overlays: Record<string, JsonObject> = {
        en: extractBaseOverlay(tree, []),
        de: buildAppOverlay('de', tree, COMPONENTS, OVERRIDES.de, { library: LIBRARY, instances: resolved.instances }),
        fr: buildAppOverlay('fr', tree, COMPONENTS, {}, { library: LIBRARY, instances: resolved.instances })
    };
    const nodeStore = store as unknown as NodeLocaleStore;
    const locale = createNodeLocale({
        store: nodeStore,
        overlays,
        baseLocale: 'en',
        componentOverlays: COMPONENTS,
        appOverrides: OVERRIDES,
        library: LIBRARY,
        instances: resolved.instances
    });
    const stop = locale.watch();
    const switchTo = (code: string) => switchLocale(nodeStore, code, overlays);
    return { store, overlays, locale, stop, switchTo };
}

describe('createNodeLocale', () => {
    it('should translate a node written while German is active and keep it translated after switching', () => {
        // Arrange
        const { store, switchTo } = setup();
        switchTo('de');

        // Act
        store.set('$.app.children.note', { component: 'text', _text: 'Text' });
        const inGerman = store.get('$.app.children.note._text');
        switchTo('en');
        const inEnglish = store.get('$.app.children.note._text');
        switchTo('de');
        const backInGerman = store.get('$.app.children.note._text');
        switchTo('fr');

        // Assert
        expect(inGerman).toBe('Text (de)');
        expect(inEnglish).toBe('Text');
        expect(backInGerman).toBe('Text (de)');
        expect(store.get('$.app.children.note._text')).toBe('Texte');
    });

    it('should leave the text the author wrote and apply the override for the path', () => {
        // Arrange
        const { store } = setup();
        store.set('$.locale', 'de');

        // Act
        store.set('$.app.children.mine', { component: 'text', _text: 'Written by hand' });
        store.set('$.app.children.special', { component: 'text', _text: 'Text' });

        // Assert
        expect(store.get('$.app.children.mine._text')).toBe('Written by hand');
        expect(store.get('$.app.children.special._text')).toBe('Besonders');
    });

    it('should not touch a node written while the base language is active but record it for later', () => {
        // Arrange
        const { store, overlays } = setup();

        // Act
        store.set('$.app.children.note', { component: 'text', _text: 'Text' });

        // Assert
        expect(store.get('$.app.children.note._text')).toBe('Text');
        expect(overlays.en).toMatchObject({ children: { note: { _text: 'Text' } } });
        expect(overlays.de).toMatchObject({ children: { note: { _text: 'Text (de)' } } });
    });

    it('should translate a composed node from the composed overlay using its instances and switch back', () => {
        // Arrange
        const { store, locale, switchTo } = setup();
        switchTo('de');
        const path = '$.app.children.box';
        const resolved = resolveNode({ component: 'card' }, LIBRARY, {}, { path });
        const row = locale.prepare(path, resolved.node, resolved.instances);

        // Act
        store.set(path, row);
        const german = [store.get(`${path}._title`), store.get(`${path}.children.body._text`)];
        switchTo('en');

        // Assert
        expect(german).toEqual(['Karte', 'Inhalt']);
        expect(store.get(`${path}._title`)).toBe('Card');
        expect(store.get(`${path}.children.body._text`)).toBe('Body');
    });

    it('should translate a static select option added under an existing select and switch back', () => {
        // Arrange
        const { store, switchTo } = setup();
        switchTo('de');

        // Act
        store.set('$.app.children.pick.options.yes', { _label: 'Yes', value: 'yes' });
        const inGerman = store.get('$.app.children.pick.options.yes._label');
        switchTo('en');
        const inEnglish = store.get('$.app.children.pick.options.yes._label');

        // Assert
        expect(inGerman).toBe('Ja');
        expect(inEnglish).toBe('Yes');
        expect(store.get('$.app.children.pick.options.no._label')).toBe('No');
    });

    it('should translate nodes inside a children map added to an existing node', () => {
        // Arrange
        const { store } = setup();
        store.set('$.app.children.group', { component: 'panel', _title: 'Group' });
        store.set('$.locale', 'de');

        // Act
        store.set('$.app.children.group.children', { one: { component: 'text', _text: 'Text' } });

        // Assert
        expect(store.get('$.app.children.group.children.one._text')).toBe('Text (de)');
    });

    it('should return a translated row from prepare, record its base and skip the write that follows', () => {
        // Arrange
        const { store, overlays, locale, switchTo } = setup();
        switchTo('de');
        const path = '$.app.children.row1';

        // Act
        const row = locale.prepare(path, { component: 'text', _text: 'Text' });
        const prepared = row._text;
        store.set(path, row);
        switchTo('en');

        // Assert
        expect(prepared).toBe('Text (de)');
        expect(store.get(`${path}._text`)).toBe('Text');
        expect(overlays.en).toMatchObject({ children: { row1: { _text: 'Text' } } });
    });

    it('should drop a deleted node from every overlay so a switch does not bring it back', () => {
        // Arrange
        const { store, overlays, switchTo } = setup();
        store.set('$.app.children.note', { component: 'text', _text: 'Text' });

        // Act
        store.delete('$.app.children.note');
        switchTo('de');

        // Assert
        expect(store.get('$.app.children.note')).toBeUndefined();
        expect(JSON.stringify(overlays)).not.toContain('note');
    });

    it('should not record a node shown through a store link and leave the nodes behind the link alone on a switch', () => {
        // Arrange
        const { store, overlays, switchTo } = setup();
        store.set('$.runtime', { pool: {} });
        store.link('$.app.children.slots', '$.runtime.pool');
        switchTo('de');

        // Act
        store.set('$.runtime.pool.0', { component: 'text', _text: 'Text (de)' });
        store.set('$.runtime.pool.1', { component: 'text', _text: 'Text (de)' });
        switchTo('en');
        switchTo('de');

        // Assert
        expect(JSON.stringify(overlays)).not.toContain('slots');
        expect(JSON.stringify(overlays)).not.toContain('pool');
        expect(store.get('$.runtime.pool.0.component')).toBe('text');
        expect(store.get('$.runtime.pool.1.component')).toBe('text');
    });

    it('should stop listening when the returned function is called', () => {
        // Arrange
        const { store, overlays, stop } = setup();
        store.set('$.locale', 'de');

        // Act
        stop();
        store.set('$.app.children.note', { component: 'text', _text: 'Text' });

        // Assert
        expect(store.get('$.app.children.note._text')).toBe('Text');
        expect(JSON.stringify(overlays)).not.toContain('note');
    });
});
