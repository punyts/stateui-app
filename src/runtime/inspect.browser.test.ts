import { afterEach, describe, expect, it } from 'vitest';
import { describeNode } from './inspect.js';

/** A node element as `<sui-node>` makes one, whose shadow root holds a layout host styled as the given CSS */
function nodeWithHost(path: string, attributes: Record<string, string>, css: string, children: number): Element {
    const wrapper = document.createElement('sui-node');
    const element = document.createElement('div');
    element.setAttribute('state', path);
    wrapper.append(element);
    document.body.append(wrapper);
    const root = element.attachShadow({ mode: 'open' });
    const host = document.createElement('div');
    host.setAttribute('layout-host', '');
    for (const [name, value] of Object.entries(attributes)) host.setAttribute(name, value);
    host.setAttribute('style', css);
    root.append(host);
    for (let index = 0; index < children; index++) {
        const childNode = document.createElement('sui-node');
        const child = document.createElement('div');
        child.setAttribute('state', `${path}.children.c${index}`);
        child.style.height = '20px';
        childNode.append(child);
        host.append(childNode);
    }
    return element;
}

describe('describeNode', () => {
    afterEach(() => document.body.replaceChildren());

    it('should give a grid the area it lays out in, its settings, its gaps and its tracks', () => {
        // Arrange
        const element = nodeWithHost(
            '$.app',
            { layout: 'grid', 'layout-cols': '3', 'layout-gap': 'md', 'layout-collapse-below': 'sm' },
            'display: grid; grid-template-columns: repeat(3, 100px); gap: 8px 10px; padding: 6px; width: 320px; box-sizing: content-box',
            4
        );

        // Act
        const node = describeNode(element, () => 'panel');

        // Assert
        expect(node.layout).toBe('grid');
        expect(node.area?.flow).toBe('grid');
        expect(node.area?.settings).toEqual({ cols: '3', gap: 'md', collapseBelow: 'sm' });
        expect(node.area?.gap).toEqual({ row: 8, column: 10 });
        expect(node.area?.columns).toEqual([100, 100, 100]);
        expect(node.area?.rows).toEqual([20, 20]);
        expect(node.area?.rect.width).toBe(320);
        expect(node.children).toHaveLength(4);
    });

    it('should tell a row from a row collapsed into a column, and give an area with no layout set', () => {
        // Arrange
        const row = nodeWithHost('$.a', { layout: 'row' }, 'display: flex; flex-direction: row; gap: 4px', 2);
        const collapsed = nodeWithHost('$.b', { layout: 'row', 'layout-collapse-below': 'md' }, 'display: flex; flex-direction: column', 2);
        const plain = nodeWithHost('$.c', {}, 'display: flex; flex-direction: column', 1);
        const free = nodeWithHost('$.d', { layout: 'adhoc' }, 'position: relative; height: 40px', 1);

        // Act
        const [a, b, c, d] = [row, collapsed, plain, free].map((element) => describeNode(element, () => 'panel'));

        // Assert
        expect(a?.area?.flow).toBe('row');
        expect(a?.area?.gap.column).toBe(4);
        expect(a?.area?.columns).toBeUndefined();
        expect(b?.area?.flow).toBe('column');
        expect(c?.layout).toBeUndefined();
        expect(c?.area?.flow).toBe('column');
        expect(c?.area?.settings).toEqual({});
        expect(d?.area?.flow).toBe('free');
    });

    it('should give no area for a node without a layout host', () => {
        // Arrange
        const element = document.createElement('div');
        element.setAttribute('state', '$.x');
        const wrapper = document.createElement('sui-node');
        wrapper.append(element);
        document.body.append(wrapper);

        // Act
        const node = describeNode(element, () => 'label');

        // Assert
        expect(node.area).toBeUndefined();
    });
});
