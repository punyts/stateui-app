import { createStore } from '@punyts/state';
import { mount, unmount } from '@punyts/stateui';
import { afterEach, describe, expect, it } from 'vitest';
import { components, registerAll } from './fixtures/expected/index.js';
import * as textLabel from './fixtures/expected/textLabel.js';

const registered = registerAll();

describe('emitted component modules in Chromium', () => {
    afterEach(() => {
        for (const host of Array.from(document.body.children)) unmount(host);
        document.body.replaceChildren();
    });

    it('should register every module through StateUI and render the simple component', async () => {
        // Arrange
        const store = createStore<{ label: { text: string; color: string } }>({ label: { text: 'Hello', color: 'black' } });
        const host = document.body.appendChild(document.createElement('div'));
        mount(host, store);

        // Act
        const element = host.appendChild(document.createElement(textLabel.tag));
        element.setAttribute('state', '$.label');

        // Assert
        expect(registered).toHaveLength(components.length);
        expect(customElements.get('ui-text-label')).toBe(registered[1]);
        expect(customElements.get('ui-field-row')).toBe(registered[0]);
        expect(element.shadowRoot?.querySelector('p')?.textContent).toBe('Hello');
    });

    it('should update the rendered text when the state is written', () => {
        // Arrange
        const store = createStore<{ label: { text: string; color: string } }>({ label: { text: 'Before', color: 'black' } });
        const host = document.body.appendChild(document.createElement('div'));
        mount(host, store);
        const element = host.appendChild(document.createElement('ui-text-label'));
        element.setAttribute('state', '$.label');

        // Act
        store.state.label.text = 'After';

        // Assert
        expect(element.shadowRoot?.querySelector('p')?.textContent).toBe('After');
    });

    it('should render the composite with the simple component inside it', () => {
        // Arrange
        const store = createStore<{ row: { label: { text: string; color: string } } }>({
            row: { label: { text: 'Nested', color: 'black' } }
        });
        const host = document.body.appendChild(document.createElement('div'));
        mount(host, store);

        // Act
        const row = host.appendChild(document.createElement('ui-field-row'));
        row.setAttribute('state', '$.row');

        // Assert
        const inner = row.shadowRoot?.querySelector('ui-text-label');
        expect(inner?.shadowRoot?.querySelector('p')?.textContent).toBe('Nested');
    });
});
