import { MAX_INSPECT_CHILDREN, MAX_INSPECT_NODES } from './limits.js';
import type { InspectedArea, InspectedNode, InspectFlow, InspectRect } from './messages.js';

/** What the store tells about a node: its component name */
export type ComponentOf = (path: string) => string | undefined;

/** The element of a node: the one `<sui-node>` creates, carrying the node's absolute path in `state` */
function isNodeElement(element: Element): boolean {
    return element.hasAttribute('state') && element.parentElement?.tagName === 'SUI-NODE';
}

/** The parent across a shadow boundary: from a shadow root's top element to its host */
function up(element: Element): Element | undefined {
    if (element.parentElement) return element.parentElement;
    const root = element.parentNode;
    return root instanceof ShadowRoot ? root.host : undefined;
}

/** The deepest element at a point, looking into open shadow roots */
function deepElementAt(doc: Document, x: number, y: number): Element | undefined {
    let found = doc.elementFromPoint(x, y) ?? undefined;
    for (let depth = 0; found?.shadowRoot && depth < 64; depth++) {
        const inner = found.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === found) break;
        found = inner;
    }
    return found;
}

/** The node elements from the one at a point out to the root, innermost first */
export function nodesAt(doc: Document, x: number, y: number): Element[] {
    const chain: Element[] = [];
    for (let element = deepElementAt(doc, x, y); element && chain.length < MAX_INSPECT_NODES; element = up(element)) {
        if (isNodeElement(element)) chain.push(element);
    }
    return chain;
}

/** The node elements of the given paths, found by walking the document and every open shadow root */
export function nodesOf(doc: Document, paths: readonly string[]): Map<string, Element> {
    const wanted = new Set(paths);
    const found = new Map<string, Element>();
    const visit = (parent: ParentNode): void => {
        for (const child of Array.from(parent.children)) {
            if (found.size === wanted.size) return;
            if (isNodeElement(child)) {
                const path = child.getAttribute('state') as string;
                if (wanted.has(path) && !found.has(path)) found.set(path, child);
            }
            if (child.shadowRoot) visit(child.shadowRoot);
            visit(child);
        }
    };
    if (wanted.size > 0) visit(doc);
    return found;
}

export function rectOf(element: Element): InspectRect {
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.x * 10) / 10, y: Math.round(box.y * 10) / 10, width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10 };
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** The pixel sizes of a resolved track list (`100px 200.5px`); none for `none` or a list that is not all pixels */
function tracks(list: string): number[] | undefined {
    const sizes = list.trim().split(/\s+/).map((part) => (/^-?[\d.]+px$/.test(part) ? round(parseFloat(part)) : Number.NaN));
    return sizes.length > 0 && sizes.every(Number.isFinite) ? sizes.slice(0, MAX_INSPECT_CHILDREN) : undefined;
}

/** The area a layout host lays children out in: its content box, its settings, how it flows them and its tracks */
function describeArea(host: Element): InspectedArea {
    const style = getComputedStyle(host);
    const box = host.getBoundingClientRect();
    const px = (value: string): number => parseFloat(value) || 0;
    const left = px(style.borderLeftWidth) + px(style.paddingLeft);
    const top = px(style.borderTopWidth) + px(style.paddingTop);
    const rect = {
        x: round(box.x + left),
        y: round(box.y + top),
        width: round(Math.max(0, box.width - left - px(style.borderRightWidth) - px(style.paddingRight))),
        height: round(Math.max(0, box.height - top - px(style.borderBottomWidth) - px(style.paddingBottom)))
    };
    const settings: Record<string, string> = {};
    for (const attribute of Array.from(host.attributes)) {
        if (!attribute.name.startsWith('layout-') || attribute.name === 'layout-host') continue;
        // layout-collapse-below is written for collapseBelow: the setting's own name again
        const name = attribute.name.slice('layout-'.length).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
        settings[name] = attribute.value;
    }
    const grid = style.display === 'grid' || style.display === 'inline-grid';
    const flex = style.display === 'flex' || style.display === 'inline-flex';
    const flow: InspectFlow = grid ? 'grid' : flex ? (style.flexDirection.startsWith('row') ? 'row' : 'column') : 'free';
    const gap = { row: round(px(style.rowGap)), column: round(px(style.columnGap)) };
    if (!grid) return { rect, settings, flow, gap };
    const columns = tracks(style.gridTemplateColumns);
    const rows = tracks(style.gridTemplateRows);
    return { rect, settings, flow, gap, ...(columns && { columns }), ...(rows && { rows }) };
}

/** What the page needs of one node: its box, its component, the layout it gives its children and their boxes */
export function describeNode(element: Element, componentOf: ComponentOf): InspectedNode {
    const path = element.getAttribute('state') as string;
    const host = element.shadowRoot?.querySelector('[layout-host]') ?? element;
    const layout = host.getAttribute('layout') ?? undefined;
    const area = host === element ? undefined : describeArea(host);
    // Without a layout host the children sit in the shadow root, or in the element itself
    const holder: ParentNode = host === element ? (element.shadowRoot ?? element) : host;
    const children: InspectedNode['children'] = [];
    for (const child of Array.from(holder.children)) {
        if (children.length >= MAX_INSPECT_CHILDREN) break;
        const item = child.tagName === 'SUI-NODE' ? child.firstElementChild : undefined;
        if (item && isNodeElement(item)) children.push({ path: item.getAttribute('state') as string, rect: rectOf(item) });
    }
    return {
        path,
        component: componentOf(path) ?? element.localName,
        ...(layout !== undefined && { layout }),
        rect: rectOf(element),
        ...(area !== undefined && { area }),
        children
    };
}
