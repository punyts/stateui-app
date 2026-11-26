import { describe, expect, it } from 'vitest';
import type { ComponentLibrary } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { AppDocument } from '../types.js';
import { metadataPaths } from './metadataPaths.js';

describe('metadataPaths', () => {
    it('should give the paths the nodes of the screens mark, a whole node for true and its properties for a list', () => {
        // Arrange
        const document = {
            start: 'signIn',
            screens: {
                signIn: {
                    root: {
                        component: 'panel',
                        '@local': ['collapsed'],
                        children: {
                            password: { component: 'textField', '@secret': ['value'] },
                            cursor: { component: 'panel', '@transient': true }
                        }
                    }
                }
            }
        } as unknown as AppDocument;

        // Act
        const paths = metadataPaths(document);

        // Assert
        expect(paths).toEqual({
            local: ['$.screens.signIn.collapsed'],
            secret: ['$.screens.signIn.children.password.value'],
            transient: ['$.screens.signIn.children.cursor']
        });
    });

    it('should add the properties the component of a node marks in its definition, with the node\'s own', () => {
        // Arrange
        const shape = parseShape({ summary: 'A button', properties: { pressed: { type: 'object', default: {} }, busy: { type: 'boolean', default: false } }, '@transient': ['pressed'] }, 'button.state.json').shape as Shape;
        const library: ComponentLibrary = { button: { tier: 'root', tag: 'ui-button', shape } };
        const document: AppDocument = { app: { component: 'page', children: { save: { component: 'button', '@transient': ['busy'] }, go: { component: 'button' } } } };

        // Act
        const paths = metadataPaths(document, library);

        // Assert
        expect(paths.transient).toEqual(['$.app.children.save.pressed', '$.app.children.save.busy', '$.app.children.go.pressed']);
    });

    it('should give nothing for a document without metadata', () => {
        // Arrange
        const document: AppDocument = { app: { component: 'page', children: { title: { component: 'text', _text: 'Hi' } } } };

        // Act
        const paths = metadataPaths(document);

        // Assert
        expect(paths).toEqual({ local: [], secret: [], transient: [] });
    });
});
