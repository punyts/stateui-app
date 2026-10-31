import { defineComponent } from '@punyts/stateui';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentOverlays } from '../../core/locale/index.js';
import type { ComponentLibrary } from '../../core/resolve/index.js';
import { parseShape } from '../../core/shape/index.js';
import type { Shape } from '../../core/shape/index.js';
import type { AppDocument, Node } from '../../core/types.js';
import { mountApp } from '../mount/index.js';
import type { MountedApp } from '../mount/index.js';
import { registerLocaleStep } from './index.js';
import type { LocaleStepHandle } from './index.js';

function shapeOf(properties: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Fixture', properties }, 'fixture.state.json');
    if (!result.shape) throw new Error(JSON.stringify(result.errors));
    return result.shape;
}

const content = { type: 'string', kind: 'content', default: '' };

const library: ComponentLibrary = {
    panel: { tier: 'root', tag: 'x-late-panel', shape: shapeOf({ children: { type: 'map', items: 'string', default: {} } }) },
    heading: { tier: 'root', tag: 'x-late-heading', shape: shapeOf({ _text: { ...content, default: 'Heading' } }) }
};

defineComponent({
    tag: 'x-late-panel',
    template: '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>'
});
defineComponent({ tag: 'x-late-heading', template: '<h1>{{ $._text }}</h1>' });

const components: ComponentOverlays = { heading: { de: { _text: 'Überschrift' } } };

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
    app: { component: 'panel', children: { first: { component: 'heading', _text: 'Heading' } } } as Node
});

describe('the locale step in Chromium', () => {
    const apps: MountedApp[] = [];
    const handles: LocaleStepHandle[] = [];

    afterEach(() => {
        for (const app of apps.splice(0)) app.dispose();
        for (const handle of handles.splice(0)) handle.unregister();
        document.body.replaceChildren();
    });

    it('should render a node added in German in German at its first render, then follow the language', () => {
        // Arrange
        const handle = registerLocaleStep(components);
        handles.push(handle);
        const host = document.body.appendChild(document.createElement('div'));
        const app = mountApp(host, documentOf(), library);
        apps.push(app);
        const atParentEvent: unknown[] = [];
        app.store?.on('$.app.children', (_path, _value, _old, action) => {
            if (action === 'insert-child') atParentEvent.push(app.store?.get('$.app.children.second._text'));
        });
        handle.switchTo('de');

        // Act
        app.store?.set('$.app.children.second', { component: 'heading', _text: 'Heading' });
        const german = textOf(host);
        handle.switchTo('en');
        const english = textOf(host);
        handle.switchTo('de');

        // Assert
        expect(app.errors).toEqual([]);
        expect(atParentEvent).toEqual(['Überschrift']);
        expect(german.match(/Überschrift/g)).toHaveLength(2);
        expect(german).not.toContain('Heading');
        expect(english.match(/Heading/g)).toHaveLength(2);
        expect(textOf(host).match(/Überschrift/g)).toHaveLength(2);
    });

    it('should leave a node alone before an application is mounted and after it is disposed', () => {
        // Arrange
        const handle = registerLocaleStep(components);
        handles.push(handle);
        const host = document.body.appendChild(document.createElement('div'));
        const app = mountApp(host, documentOf(), library);

        // Act
        const mountedNodes = handle.nodes;
        app.dispose();

        // Assert
        expect(mountedNodes).toBeDefined();
        expect(handle.nodes).toBeUndefined();
        expect(handle.switchTo('de').map((error) => error.code)).toEqual(['SUI-LOCALE-UNKNOWN']);
    });
});
