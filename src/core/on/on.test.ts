import { describe, expect, it } from 'vitest';
import { resolveNode } from '../resolve/index.js';
import type { ComponentLibrary } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { Node } from '../types.js';
import { parseTarget, readEntry, validateOn } from './index.js';

function shapeOf(properties: Record<string, unknown>, events: string[] = [], commands: string[] = []): Shape {
    const result = parseShape({ summary: 'Test', properties, events, commands }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const LIBRARY: ComponentLibrary = {
    button: {
        tier: 'root',
        tag: 'ui-button',
        shape: shapeOf({ _title: { type: 'string', kind: 'content', default: 'Go' }, pressed: { type: 'boolean', default: false } }, ['press'])
    },
    toolbar: { tier: 'root', tag: 'ui-toolbar', shape: shapeOf({ align: { type: 'string', default: 'start' } }) },
    form: {
        tier: 'root',
        tag: 'ui-form',
        shape: shapeOf({ note: { type: 'string', default: '' } }, ['submitted'], ['submit', 'reset'])
    },
    modal: {
        tier: 'root',
        tag: 'ui-modal',
        shape: shapeOf({ body: { type: 'node' }, footer: { type: 'node' } }, ['close'], ['open', 'close'])
    },
    orderEditor: {
        tier: 'composed',
        tree: {
            component: 'modal',
            on: { close: { command: 'reset', target: '.body.children.form' } },
            body: { component: 'toolbar', children: { form: { component: 'form' } } },
            footer: {
                component: 'toolbar',
                children: {
                    save: { component: 'button', on: { press: { command: 'submit', target: '^orderEditor.body.children.form' } } },
                    cancel: { component: 'button', on: { press: { command: 'close', target: '$parent' } } }
                }
            }
        }
    }
};

function check(app: Node) {
    const resolved = resolveNode(app, LIBRARY);
    expect(resolved.errors).toEqual([]);
    return validateOn(resolved, LIBRARY);
}

function button(on: unknown): Node {
    return { component: 'toolbar', children: { b: { component: 'button', on } as Node } };
}

describe('validateOn', () => {
    it('should accept the order editor placed at two depths', () => {
        const app: Node = {
            component: 'toolbar',
            children: {
                one: { component: 'orderEditor' },
                inner: { component: 'toolbar', children: { two: { component: 'orderEditor' } } }
            }
        };

        expect(check(app)).toEqual([]);
    });

    it('should accept set, toggle and emit', () => {
        const errors = check(
            button({
                press: [
                    { command: 'set', target: '$.data.name', value: 'x' },
                    { command: 'toggle', target: '.pressed' },
                    { command: 'emit', target: 'orders.edit' }
                ]
            })
        );

        expect(errors).toEqual([]);
    });

    it('should accept a component command on an absolute target', () => {
        const app: Node = {
            component: 'toolbar',
            children: { f: { component: 'form' }, b: { component: 'button', on: { press: { command: 'submit', target: '$.app.children.f' } } } }
        };

        expect(check(app)).toEqual([]);
    });

    it('should pick the nearest of two ancestors with the same key', () => {
        const app: Node = {
            component: 'toolbar',
            children: {
                box: {
                    component: 'toolbar',
                    children: {
                        box: {
                            component: 'toolbar',
                            children: { f: { component: 'form' }, b: { component: 'button', on: { press: { command: 'submit', target: '^box.children.f' } } } }
                        }
                    }
                }
            }
        };

        expect(check(app)).toEqual([]);
    });

    it('should find the nearer box when only the nearer one holds the path', () => {
        const app: Node = {
            component: 'toolbar',
            children: {
                box: {
                    component: 'toolbar',
                    children: {
                        f: { component: 'form' },
                        box: { component: 'toolbar', children: { b: { component: 'button', on: { press: { command: 'submit', target: '^box.children.f' } } } } }
                    }
                }
            }
        };

        const errors = check(app);

        expect(errors.map((error) => error.code)).toEqual(['SUI-ON-TARGET']);
    });

    it('should report an unknown ancestor key as SUI-ON-TARGET with the entry path', () => {
        const errors = check(button({ press: { command: 'submit', target: '^nobody.f' } }));

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 'SUI-ON-TARGET', statePath: '$.app.children.b.on.press' });
    });

    it('should reject dot climbing', () => {
        const errors = check(button({ press: { command: 'submit', target: '..x' } }));

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 'SUI-ON-TARGET', statePath: '$.app.children.b.on.press' });
    });

    it('should report a bad event', () => {
        const errors = check(button({ hover: { command: 'set', target: '.pressed', value: true } }));

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 'SUI-ON-EVENT', statePath: '$.app.children.b.on.hover' });
    });

    it('should report a bad command on the target component', () => {
        const app: Node = {
            component: 'toolbar',
            children: { f: { component: 'form' }, b: { component: 'button', on: { press: { command: 'open', target: '$.app.children.f' } } } }
        };

        const errors = check(app);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 'SUI-ON-COMMAND', statePath: '$.app.children.b.on.press' });
    });

    it('should report a missing target node and a missing provider', () => {
        const missing = check(button({ press: { command: 'submit', target: '.children.nope' } }));
        const provider = check(button({ press: { command: 'submit', target: '$parent' } }));

        expect(missing.map((error) => error.code)).toEqual(['SUI-ON-TARGET']);
        expect(provider.map((error) => error.code)).toEqual(['SUI-ON-TARGET']);
    });

    it('should report a set that does not target a declared property', () => {
        const errors = check(button({ press: { command: 'set', target: '.nothing', value: 1 } }));

        expect(errors.map((error) => error.code)).toEqual(['SUI-ON-TARGET']);
    });

    it('should report a malformed on entry with its state path', () => {
        const notMap = check(button('press'));
        const bad = check(button({ press: 'close' }));
        const empty = check(button({ press: [] }));
        const item = check(button({ press: [{ command: 'set', target: '.pressed', value: true }, { target: '.x' }] }));
        const extra = check(button({ press: { command: 'submit', color: 1 } }));

        expect(notMap[0]?.statePath).toBe('$.app.children.b.on');
        expect(bad[0]?.statePath).toBe('$.app.children.b.on.press');
        expect(empty[0]?.statePath).toBe('$.app.children.b.on.press');
        expect(item[0]?.statePath).toBe('$.app.children.b.on.press.1');
        expect(extra[0]?.statePath).toBe('$.app.children.b.on.press');
    });
});

describe('parseTarget and readEntry', () => {
    it('should read the four target forms', () => {
        expect(parseTarget('^a.b.c')).toEqual({ form: 'named', name: 'a', segments: ['b', 'c'] });
        expect(parseTarget('^a')).toEqual({ form: 'named', name: 'a', segments: [] });
        expect(parseTarget('.a.b')).toEqual({ form: 'own', segments: ['a', 'b'] });
        expect(parseTarget('$parent')).toEqual({ form: 'parent' });
        expect(parseTarget('$.app.x')).toEqual({ form: 'absolute', segments: ['app', 'x'] });
    });

    it('should refuse climbing and odd forms', () => {
        for (const text of ['..x', '...x', '.', '$.', '$.a..b', 'x', '$row', '^', '^a..b']) {
            expect(parseTarget(text)).toBeUndefined();
        }
    });

    it('should read one command or a list', () => {
        expect(readEntry({ command: 'close' })).toEqual([{ command: 'close' }]);
        expect(readEntry([{ command: 'a', value: 0 }])).toEqual([{ command: 'a', value: 0 }]);
        expect(readEntry(null)).toBeUndefined();
    });
});
