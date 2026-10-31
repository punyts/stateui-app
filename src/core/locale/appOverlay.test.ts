import { describe, expect, it } from 'vitest';
import { validateDocument } from '../validate/index.js';
import { cloneJson, resolveNode } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { AppDocument, JsonObject, Node } from '../types.js';
import {
    MAX_MISSING_PER_LANGUAGE,
    buildAppOverlay,
    extractBaseOverlay,
    findUntranslated,
    validateAppLocale,
    validateComponentOverlay
} from './index.js';

function shapeOf(properties: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', properties }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const TEXT = { type: 'string', kind: 'content', default: '' };

const LIBRARY: ComponentLibrary = {
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({ _title: TEXT }) },
    text: { tier: 'root', tag: 'ui-text', shape: shapeOf({ _text: { ...TEXT, default: 'Text' }, _errors: { type: 'object', kind: 'content', default: {} } }) },
    select: {
        tier: 'root',
        tag: 'ui-select',
        shape: shapeOf({ options: { type: 'map', items: { _label: TEXT, value: { type: 'string', default: '' } }, default: {} } })
    },
    tabs: { tier: 'root', tag: 'ui-tabs', shape: shapeOf({ _title: TEXT }) }
};

const CARD: Node = { component: 'panel', _title: 'Card', children: { body: { component: 'text', _text: 'Body' } } };
const FILTER: Node = {
    component: 'panel',
    children: {
        status: { component: 'select', options: { open: { _label: 'Open', value: 'open' }, done: { _label: 'Done', value: 'done' } } },
        tabs: {
            component: 'tabs',
            children: { one: { component: 'text', _text: 'First', placement: { _tab: 'One' } } }
        }
    }
};

const LIBRARY_WITH_COMPOSED: ComponentLibrary = { ...LIBRARY, card: { tier: 'composed', tree: CARD }, filter: { tier: 'composed', tree: FILTER } };

function resolved(app: Node) {
    return resolveNode(cloneJson(app as JsonObject) as Node, LIBRARY_WITH_COMPOSED, {});
}

describe('buildAppOverlay', () => {
    it('should translate a composed component used three times from one overlay', () => {
        // Arrange
        const app: Node = {
            component: 'panel',
            children: { a: { component: 'card' }, b: { component: 'card' }, c: { component: 'card' } }
        };
        const { node, instances } = resolved(app);
        const components = { card: { de: { _title: 'Karte', children: { body: { _text: 'Inhalt' } } } } };

        // Act
        const overlay = buildAppOverlay('de', node, components, {}, { library: LIBRARY_WITH_COMPOSED, instances });

        // Assert
        const german = { _title: 'Karte', children: { body: { _text: 'Inhalt' } } };
        expect(overlay).toEqual({ children: { a: german, b: german, c: german } });
    });

    it('should let the application override win over the component overlay', () => {
        // Arrange
        const app: Node = { component: 'panel', children: { a: { component: 'card' }, b: { component: 'card' } } };
        const { node, instances } = resolved(app);
        const components = { card: { de: { _title: 'Karte', children: { body: { _text: 'Inhalt' } } } } };
        const overrides: JsonObject = { children: { b: { _title: 'Sonderkarte' } } };

        // Act
        const overlay = buildAppOverlay('de', node, components, overrides, { library: LIBRARY_WITH_COMPOSED, instances });

        // Assert
        expect(overlay).toEqual({
            children: {
                a: { _title: 'Karte', children: { body: { _text: 'Inhalt' } } },
                b: { _title: 'Sonderkarte', children: { body: { _text: 'Inhalt' } } }
            }
        });
    });

    it('should translate static select options and a tabs child tab from the component overlay', () => {
        // Arrange
        const app: Node = { component: 'panel', children: { filter: { component: 'filter' } } };
        const { node, instances } = resolved(app);
        const components = {
            filter: {
                de: {
                    children: {
                        status: { options: { open: { _label: 'Offen' }, done: { _label: 'Erledigt' } } },
                        tabs: { children: { one: { _text: 'Erstens', placement: { _tab: 'Eins' } } } }
                    }
                }
            }
        };

        // Act
        const overlay = buildAppOverlay('de', node, components, {}, { library: LIBRARY_WITH_COMPOSED, instances });

        // Assert
        expect(overlay).toEqual({ children: { filter: components.filter.de } });
        expect(validateAppLocale('de', node, components, {}, { library: LIBRARY_WITH_COMPOSED, instances })).toEqual([]);
    });

    it('should leave content the author wrote alone and translate the component default', () => {
        // Arrange
        const app: Node = {
            component: 'panel',
            children: { written: { component: 'text', _text: 'Orders' }, plain: { component: 'text' } }
        };
        const { node } = resolved(app);
        const components = { text: { de: { _text: 'Text' as string } } };
        components.text.de._text = 'Textfeld';

        // Act
        const overlay = buildAppOverlay('de', node, components, {}, { library: LIBRARY_WITH_COMPOSED });

        // Assert
        expect(overlay).toEqual({ children: { plain: { _text: 'Textfeld' } } });
    });

    it('should not add a path the node does not have or a linked one', () => {
        // Arrange
        const node: JsonObject = { component: 'panel', _title: 'T', children: { a: { component: 'text' } } };
        const components = { text: { de: { _text: 'Textfeld', _errors: { required: 'Pflicht' } } } };

        // Act
        const overlay = buildAppOverlay('de', node, components, {}, { linkedPaths: ['$.app.children.a._text'] });

        // Assert
        expect(overlay).toEqual({});
    });

    it('should not change what it is given', () => {
        // Arrange
        const app: Node = { component: 'panel', children: { a: { component: 'card' } } };
        const { node, instances } = resolved(app);
        const components = { card: { de: { _title: 'Karte' } } };
        const nodeCopy = structuredClone(node);
        const overrides: JsonObject = { children: { a: { _title: 'X' } } };
        const overridesCopy = structuredClone(overrides);

        // Act
        const overlay = buildAppOverlay('de', node, components, overrides, { library: LIBRARY_WITH_COMPOSED, instances });
        (overlay.children as { a: JsonObject }).a._title = 'Changed';

        // Assert
        expect(node).toEqual(nodeCopy);
        expect(overrides).toEqual(overridesCopy);
        expect(components.card.de._title).toBe('Karte');
    });
});

describe('validateAppLocale and findUntranslated', () => {
    function manyTexts(count: number): Node {
        const children: Record<string, JsonObject> = {};
        for (let index = 0; index < count; index += 1) children[`t${String(index).padStart(2, '0')}`] = { component: 'text', _text: `Text ${index}` };
        return { component: 'panel', children };
    }

    it('should allow a language with overlays for only some components and warn for each missing path', () => {
        // Arrange
        const app: Node = { component: 'panel', _title: 'Orders', children: { a: { component: 'card' }, b: { component: 'text', _text: 'Hello' } } };
        const { node, instances } = resolved(app);
        const components = { card: { de: { _title: 'Karte' } } };

        // Act
        const result = validateAppLocale('de', node, components, {}, { library: LIBRARY_WITH_COMPOSED, instances });

        // Assert
        expect(result.map((error) => [error.code, error.severity, error.statePath])).toEqual([
            ['SUI-LOCALE-MISSING', 'warning', '$.app._title'],
            ['SUI-LOCALE-MISSING', 'warning', '$.app.children.a.children.body._text'],
            ['SUI-LOCALE-MISSING', 'warning', '$.app.children.b._text']
        ]);
        expect(result[0]?.message).toBe('Language "de" does not translate $.app._title');
    });

    it('should cap the warnings at 50 per language and count the rest', () => {
        // Arrange
        const { node } = resolved(manyTexts(60));

        // Act
        const result = validateAppLocale('de', node, {}, {}, { library: LIBRARY_WITH_COMPOSED });

        // Assert
        expect(MAX_MISSING_PER_LANGUAGE).toBe(50);
        expect(result).toHaveLength(51);
        expect(result[49]?.statePath).toBe('$.app.children.t49._text');
        expect(result[50]).toMatchObject({ code: 'SUI-LOCALE-MORE', severity: 'warning' });
        expect(result[50]?.message).toBe('Language "de" has 10 more untranslated content paths; 50 are listed');
        expect(result.every((error) => error.severity === 'warning')).toBe(true);
    });

    it('should not warn when 50 or fewer paths are missing, when content is empty or when all is translated', () => {
        // Arrange
        const { node } = resolved(manyTexts(50));
        const base = extractBaseOverlay(node, []);
        const empty = resolved({ component: 'panel', _title: '' });

        // Act
        const exact = findUntranslated('de', base, {});
        const none = findUntranslated('de', base, base);
        const blank = findUntranslated('de', extractBaseOverlay(empty.node, []), {});

        // Assert
        expect(exact).toHaveLength(50);
        expect(none).toEqual([]);
        expect(blank).toEqual([]);
    });

    it('should return the errors of a bad override with the warnings', () => {
        // Arrange
        const { node } = resolved({ component: 'panel', _title: 'Orders' });

        // Act
        const result = validateAppLocale('de', node, {}, { _subtitle: 'x' }, { library: LIBRARY_WITH_COMPOSED });

        // Assert
        expect(result.map((error) => error.code)).toEqual(['SUI-LOCALE-PATH', 'SUI-LOCALE-MISSING']);
    });
});

describe('validateComponentOverlay', () => {
    const select = LIBRARY['select'];
    const shape = select?.tier === 'root' ? select.shape : (undefined as never);

    it('should accept content properties and map items with any key', () => {
        // Arrange
        const overlay: JsonObject = { options: { open: { _label: 'Offen' }, done: { _label: 'Erledigt' } } };

        // Act
        const errors = validateComponentOverlay('de', overlay, shape);

        // Assert
        expect(errors).toEqual([]);
    });

    it('should reject a property that is not content, an unknown one and a value that is not text', () => {
        // Arrange
        const overlay: JsonObject = { options: { open: { value: 'x', _label: 4, _other: 'y' } }, ghost: 'x', _nope: 'z' };

        // Act
        const errors = validateComponentOverlay('de', overlay, shape);

        // Assert
        expect(errors.map((error) => [error.code, error.statePath])).toEqual([
            ['SUI-LOCALE-CONTENT', '$.options.open.value'],
            ['SUI-LOCALE-CONTENT', '$.options.open._label'],
            ['SUI-LOCALE-PATH', '$.options.open._other'],
            ['SUI-LOCALE-PATH', '$.ghost'],
            ['SUI-LOCALE-PATH', '$._nope']
        ]);
    });
});

describe('document validation of locales', () => {
    it('should report a bad override through validateDocument and accept a good one', () => {
        // Arrange
        const base = { app: { component: 'panel', _title: 'Orders', children: { a: { component: 'text', _text: 'Hi' } } } };
        const good = { ...base, locales: { de: { _title: 'Aufträge' } } } as unknown as AppDocument;
        const bad = { ...base, locales: { de: { _title: 'Aufträge', ghost: { _text: 'x' }, children: { a: { component: 'x' } } } } } as unknown as AppDocument;

        // Act
        const accepted = validateDocument(good, LIBRARY);
        const rejected = validateDocument(bad, LIBRARY);

        // Assert
        expect(accepted.errors.filter((error) => error.code.startsWith('SUI-LOCALE'))).toEqual([]);
        expect(rejected.errors.map((error) => error.code).filter((code) => code.startsWith('SUI-LOCALE'))).toEqual(['SUI-LOCALE-PATH', 'SUI-LOCALE-CONTENT']);
        expect(rejected.valid).toBe(false);
    });
});
