import type { AppDocument } from '../../types.js';
import { deepFreeze } from './freeze.js';

/**
 * A store faking two pages with a hidden-strip `tabs` (`$.app.children.pages`): a header above it, a home tab with an
 * intro, a composed `Product Card` and a button that opens the bag tab, and a bag tab with a list of `$.data.bag`. A
 * theme with a night overlay, a German overlay of the header and the intro, and a rule that writes the bag tab's count
 */
export const TABS_APP: AppDocument = deepFreeze({
    theme: { tokens: { color: { accent: { base: '#0050a0' } } }, active: { mode: 'night' } },
    themes: { night: { kind: 'mode', tokens: { color: { surface: { base: '#101820' } } } } },
    app: {
        component: 'page',
        _title: 'Halo',
        children: {
            header: { component: 'text', _text: 'Welcome to Halo' },
            pages: {
                component: 'tabs',
                strip: 'hidden',
                active: 'home',
                children: {
                    home: {
                        component: 'panel',
                        placement: { _tab: 'Home' },
                        children: {
                            intro: { component: 'text', _text: 'Lamps and chairs' },
                            featured: { component: 'Product Card' },
                            open: {
                                component: 'button',
                                _title: 'Open bag',
                                on: { press: { command: 'set', target: '$.app.children.pages.active', value: 'Bag' } }
                            }
                        }
                    },
                    Bag: {
                        component: 'panel',
                        placement: { _tab: 'Your bag' },
                        children: {
                            count: { component: 'text', _text: '' },
                            lines: { component: 'list', '<-items': '$.data.bag', row: { component: 'text', '<-_text': '$row.product' } }
                        }
                    }
                }
            }
        }
    },
    composed: {
        'Product Card': {
            component: 'panel',
            _title: 'Product',
            children: { name: { component: 'text', _text: 'A product' } },
            exposes: { 'children.name._text': 'The product name' }
        }
    },
    data: {
        products: [
            { id: 'p1', name: 'Lamp', price: 30 },
            { id: 'p2', name: 'Chair', price: 90.5 }
        ],
        bag: { l1: { product: 'p1', qty: 1 } }
    },
    logic: {
        rules: {
            counted: {
                when: { path: '$.data.bag' },
                do: [{ command: 'set', target: '$.app.children.pages.children.Bag.children.count._text', value: '{{ count($.data.bag) }} lines' }]
            }
        }
    },
    locales: {
        de: {
            children: {
                header: { _text: 'Willkommen bei Halo' },
                pages: { children: { home: { placement: { _tab: 'Start' }, children: { intro: { _text: 'Lampen und Stühle' } } } } }
            }
        }
    }
}) as unknown as AppDocument;

/** The tabs app whose logic switches the strip itself, which screens cannot follow */
export const STRIP_LOGIC_APP: AppDocument = deepFreeze({
    ...(JSON.parse(JSON.stringify(TABS_APP)) as AppDocument),
    logic: {
        rules: {
            toBag: { when: { path: '$.data.bag' }, do: [{ command: 'set', target: '$.app.children.pages.active', value: 'Bag' }] }
        }
    }
}) as AppDocument;
