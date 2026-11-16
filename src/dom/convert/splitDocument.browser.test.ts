import { report } from '@punyts/core';
import { defineComponent } from '@punyts/stateui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assembleApp } from '../../core/assemble/index.js';
import { splitDocument } from '../../core/convert/index.js';
import { CONVERT_LIBRARY, CONVERT_TAGS } from '../../core/convert/fixtures/library.js';
import { TABS_APP } from '../../core/convert/fixtures/tabsApp.js';
import type { AppDocument } from '../../core/types.js';
import { mountApp } from '../mount/index.js';
import type { MountedApp } from '../mount/index.js';

const CHILDREN = '<sui-node repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" state="{{ $v }}"></sui-node>';

defineComponent({ tag: CONVERT_TAGS.page, template: `<h1>{{ $._title }}</h1>${CHILDREN}` });
defineComponent({ tag: CONVERT_TAGS.panel, template: `<h2>{{ $._title }}</h2>${CHILDREN}` });
defineComponent({ tag: CONVERT_TAGS.text, template: '<p>{{ $._text }}</p>' });
defineComponent({ tag: CONVERT_TAGS.button, template: '<button type="button">{{ $._title }}</button>' });
defineComponent({ tag: CONVERT_TAGS.list, template: '<ul></ul>' });
/** Shows only the active child, as a hidden-strip tabs does */
defineComponent({
    tag: CONVERT_TAGS.tabs,
    template: '<div repeat="{{ $k,$i,$v in $.children }}" key="{{ $k }}" hidden="{{ $k !== $.active }}"><sui-node state="{{ $v }}"></sui-node></div>'
});
defineComponent({ tag: CONVERT_TAGS.app, template: '<section layout-host=""></section>' });

/** The text a person sees below `node`: across shadow roots and slots, skipping what is not displayed */
function visibleText(node: Node, words: string[] = []): string[] {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim() ?? '';
        if (text !== '') words.push(text);
        return words;
    }
    if (node instanceof Element) {
        if (getComputedStyle(node).display === 'none') return words;
        if (node instanceof HTMLSlotElement) {
            for (const assigned of node.assignedNodes({ flatten: true })) visibleText(assigned, words);
            return words;
        }
        if (node.shadowRoot) {
            for (const child of Array.from(node.shadowRoot.childNodes)) visibleText(child, words);
            return words;
        }
    }
    for (const child of Array.from(node.childNodes)) visibleText(child, words);
    return words;
}

describe('a converted hidden-strip tabs app in Chromium', () => {
    const apps: MountedApp[] = [];

    function mount(document: AppDocument): HTMLElement {
        const host = window.document.body.appendChild(window.document.createElement('div'));
        apps.push(mountApp(host, JSON.parse(JSON.stringify(document)) as AppDocument, CONVERT_LIBRARY));
        return host;
    }

    beforeEach(() => {
        vi.spyOn(report, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        for (const app of apps.splice(0)) app.dispose();
        vi.restoreAllMocks();
        window.document.body.replaceChildren();
    });

    it('should show its first screen with the same visible text as the first tab of the original', () => {
        // Arrange
        const result = splitDocument({ name: 'Halo Store', document: TABS_APP });
        if (result.app === undefined) throw new Error(JSON.stringify(result.report));
        const { document, errors } = assembleApp(result.app.blueprint, result, { library: CONVERT_LIBRARY });

        // Act
        const original = visibleText(mount(TABS_APP));
        const converted = visibleText(mount(document));

        // Assert
        expect(errors).toEqual([]);
        expect(original).toEqual(['Lamps and chairs', 'Product', 'A product', 'Open bag']);
        expect(converted).toEqual(original);
    });
});
