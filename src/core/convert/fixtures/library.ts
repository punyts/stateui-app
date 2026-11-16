import type { ComponentLibrary } from '../../resolve/index.js';
import { parseShape } from '../../shape/index.js';
import type { Shape } from '../../shape/index.js';
import { deepFreeze } from './freeze.js';

function shapeOf(json: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', events: [], commands: [], ...json }, 'test.state.json');
    if (result.shape === undefined) throw new Error(`fixture shape: ${JSON.stringify(result.errors)}`);
    return result.shape;
}

const content = { type: 'string', kind: 'content', default: '' };

/** The tags of `CONVERT_LIBRARY`, for a browser test to define */
export const CONVERT_TAGS = {
    page: 'x-cv-page',
    panel: 'x-cv-panel',
    form: 'x-cv-form',
    toolbar: 'x-cv-toolbar',
    textField: 'x-cv-text-field',
    selectField: 'x-cv-select-field',
    list: 'x-cv-list',
    text: 'x-cv-text',
    modal: 'x-cv-modal',
    button: 'x-cv-button',
    tabs: 'x-cv-tabs',
    app: 'x-cv-app'
} as const;

/** The components the converter fixtures use, with the properties they set */
export const CONVERT_LIBRARY: ComponentLibrary = deepFreeze({
    page: { tier: 'root', tag: CONVERT_TAGS.page, shape: shapeOf({ layout: true, properties: { _title: content, footer: { type: 'node' } } }) },
    panel: { tier: 'root', tag: CONVERT_TAGS.panel, shape: shapeOf({ layout: true, properties: { _title: content } }) },
    form: { tier: 'root', tag: CONVERT_TAGS.form, shape: shapeOf({ layout: true, properties: {} }) },
    toolbar: { tier: 'root', tag: CONVERT_TAGS.toolbar, shape: shapeOf({ layout: true, properties: {} }) },
    textField: { tier: 'root', tag: CONVERT_TAGS.textField, shape: shapeOf({ properties: { _label: content, required: { type: 'boolean', default: false } } }) },
    selectField: { tier: 'root', tag: CONVERT_TAGS.selectField, shape: shapeOf({ properties: { _label: content, options: { type: 'object', default: {} } } }) },
    list: { tier: 'root', tag: CONVERT_TAGS.list, shape: shapeOf({ properties: { items: { type: ['array', 'object'] }, row: { type: 'node', row: true } } }) },
    text: { tier: 'root', tag: CONVERT_TAGS.text, shape: shapeOf({ properties: { _text: content } }) },
    modal: { tier: 'root', tag: CONVERT_TAGS.modal, shape: shapeOf({ properties: { open: { type: 'boolean', default: false }, _title: content } }) },
    button: { tier: 'root', tag: CONVERT_TAGS.button, shape: shapeOf({ events: ['press'], shared: { tone: {} }, properties: { _title: content } }) },
    tabs: {
        tier: 'root',
        tag: CONVERT_TAGS.tabs,
        shape: shapeOf({
            placement: { _tab: content },
            properties: {
                active: { type: 'string', default: '' },
                strip: { type: 'string', values: ['visible', 'hidden'], default: 'visible' }
            }
        })
    },
    app: { tier: 'root', tag: CONVERT_TAGS.app, shape: shapeOf({ layout: true, properties: { _title: content } }) }
}) as ComponentLibrary;
