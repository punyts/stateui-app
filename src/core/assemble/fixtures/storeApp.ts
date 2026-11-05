import type { AppBlueprint } from '../../blueprint/types.js';
import type { ComponentLibrary } from '../../resolve/index.js';
import { parseShape } from '../../shape/index.js';
import type { Shape } from '../../shape/index.js';
import type { PartSource } from '../types.js';

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
    }
    return value;
}

function shapeOf(properties: Record<string, unknown>, layout = false): Shape {
    const result = parseShape({ summary: 'Test', properties, events: [], commands: [], layout }, 'test.state.json');
    if (result.shape === undefined) throw new Error(`fixture shape: ${JSON.stringify(result.errors)}`);
    return result.shape;
}

/** A small library: a page frame, panels, text, and the `outlet` the shell shows screens in */
export const STORE_LIBRARY: ComponentLibrary = deepFreeze({
    page: { tier: 'root', tag: 'ui-page', shape: shapeOf({ title: { type: 'string', default: '' } }, true) },
    panel: { tier: 'root', tag: 'ui-panel', shape: shapeOf({ title: { type: 'string', default: '' } }, true) },
    text: { tier: 'root', tag: 'ui-text', shape: shapeOf({ _value: { type: 'string', kind: 'content', default: '' } }) },
    outlet: { tier: 'root', tag: 'ui-outlet', shape: shapeOf({}) },
    banner: { tier: 'composed', tree: { component: 'panel', title: 'Library banner' } }
}) as ComponentLibrary;

/** A store: a shell with a header and an outlet, a home and a product screen, one theme, a catalog dataset, a persona bag and the cart module */
export const STORE_APP: AppBlueprint = deepFreeze({
    title: 'Store',
    uses: {
        themes: ['store'],
        data: {
            products: { dataset: 'catalog' },
            bag: { model: 'bag-line', scope: 'persona' },
            totals: { model: 'cart-totals', scope: 'persona' }
        },
        logic: { cart: { params: { taxRate: 0.2, currency: 'EUR' } } }
    },
    start: 'home',
    shell: {
        component: 'page',
        children: {
            header: { component: 'panel', children: { brand: { component: 'brand-mark' } } },
            main: { component: 'outlet' }
        }
    },
    screens: {
        home: {
            title: 'Store',
            root: { component: 'panel', title: 'Products', children: { intro: { component: 'text', _value: 'Our products' } } }
        },
        product: {
            title: 'Product',
            params: { id: { type: 'string', required: true } },
            root: { component: 'panel', children: { card: { component: 'product-card' } } }
        }
    },
    logic: {
        rules: { opened: { when: { path: '$.data.products' }, do: [{ command: 'set', target: '$.app.title', value: 'Store' }] } }
    },
    locales: { de: { 'Our products': 'Unsere Produkte' } }
});

/** The owner's parts the store uses, plus parts it does not use */
export const STORE_PARTS: PartSource = deepFreeze({
    themes: {
        store: {
            tokens: { color: { brand: '#204080' } },
            overlays: { dark: { kind: 'mode', tokens: { color: { brand: '#8090c0' } } } }
        },
        plain: { tokens: {} }
    },
    datasets: {
        catalog: { model: 'product', records: { p1: { name: 'Lamp', price: 30 }, p2: { name: 'Chair', price: 90 } } },
        orders: { records: {} }
    },
    models: {
        product: { fields: { name: { type: 'string', required: true }, price: { type: 'number', default: 0 } } },
        'bag-line': { fields: { product: { type: 'string', required: true }, qty: { type: 'integer', required: true }, line: { type: 'number' } } },
        'cart-totals': { fields: { net: { type: 'number', default: 0 }, gross: { type: 'number', default: 0 }, currency: { type: 'string', default: 'USD' } } },
        unused: { fields: {} }
    },
    modules: {
        cart: {
            needs: { bag: { model: 'bag-line' }, totals: { model: 'cart-totals' } },
            params: {
                taxRate: { type: 'number', default: 0, validators: { range: { min: 0, max: 1 } } },
                currency: { type: 'string', default: 'USD', validators: { pattern: '^[A-Z]{3}$' } }
            },
            rules: {
                totals: {
                    when: { path: '$.data.bag' },
                    do: [
                        { command: 'set', target: '$.data.totals.net', value: "{{ sum($.data.bag, 'line') }}" },
                        { command: 'set', target: '$.data.totals.gross', value: "{{ round(sum($.data.bag, 'line') * (1 + $params.taxRate) * 100) / 100 }}" },
                        { command: 'set', target: '$.data.totals.currency', value: '$params.currency' }
                    ]
                }
            }
        },
        wishlist: { needs: { wishes: { model: 'product' } }, params: {} }
    },
    components: {
        'brand-mark': {
            tree: { component: 'text', _value: 'Store' },
            exposes: [{ path: '_value', description: 'The brand text' }],
            summary: 'The store name',
            category: 'content',
            purposes: ['show the brand', 'name the store', 'mark the header']
        },
        'product-card': { tree: { component: 'panel', children: { name: { component: 'text' }, mark: { component: 'brand-mark' } } }, exposes: [] },
        unused: { tree: { component: 'panel' }, exposes: [] }
    }
}) as PartSource;
