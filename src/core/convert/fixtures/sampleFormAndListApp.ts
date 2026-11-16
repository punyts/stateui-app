import type { AppDocument } from '../../types.js';
import { deepFreeze } from './freeze.js';

/**
 * A copy of the MCP package's `SAMPLE_FORM_AND_LIST_APP` (the app package does not import from the MCP package): a
 * `page` with a `panel` that holds a `form` and a `list` linked to `$.data.customers`, a footer `toolbar` with a Save
 * `button`, and a closed `modal`. One screen, no tabs
 */
export const SAMPLE_FORM_AND_LIST_APP: AppDocument = deepFreeze({
    app: {
        component: 'page',
        _title: 'Customers',
        children: {
            main: {
                component: 'panel',
                _title: 'Customer list',
                children: {
                    form: {
                        component: 'form',
                        children: {
                            name: { component: 'textField', _label: 'Name', required: true },
                            status: {
                                component: 'selectField',
                                _label: 'Status',
                                options: {
                                    active: { _label: 'Active' },
                                    paused: { _label: 'Paused' }
                                }
                            }
                        }
                    },
                    customers: {
                        component: 'list',
                        '<-items': '$.data.customers',
                        row: { component: 'text', '<-_text': '$row.name' }
                    }
                }
            },
            confirm: { component: 'modal', open: false, _title: 'Discard changes?' }
        },
        footer: {
            component: 'toolbar',
            children: {
                save: { component: 'button', _title: 'Save', tone: 'accent' }
            }
        }
    },
    data: {
        customers: [
            { id: 'c1', name: 'Ada Lovelace' },
            { id: 'c2', name: 'Grace Hopper' }
        ]
    }
}) as AppDocument;
