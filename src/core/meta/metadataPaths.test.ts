import { describe, expect, it } from 'vitest';
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

    it('should give nothing for a document without metadata', () => {
        // Arrange
        const document: AppDocument = { app: { component: 'page', children: { title: { component: 'text', _text: 'Hi' } } } };

        // Act
        const paths = metadataPaths(document);

        // Assert
        expect(paths).toEqual({ local: [], secret: [], transient: [] });
    });
});
