import { describe, expect, it } from 'vitest';
import type { ComponentLibrary } from '../resolve/index.js';
import { resolveNode } from '../resolve/index.js';
import { parseShape } from '../shape/index.js';
import type { Shape } from '../shape/index.js';
import type { Node } from '../types.js';
import { checkComposedExposes, checkExposes, exposedPathResolves, parseComposed } from './index.js';

function shapeOf(input: Record<string, unknown>): Shape {
    const result = parseShape({ summary: 'Test', ...input }, 'test.state.json');
    expect(result.errors).toEqual([]);
    return result.shape as Shape;
}

const LIBRARY: ComponentLibrary = {
    text: { tier: 'root', tag: 'ui-text', shape: shapeOf({ properties: { _text: { type: 'string', kind: 'content', default: 'Text' } } }) },
    button: {
        tier: 'root',
        tag: 'ui-button',
        shape: shapeOf({
            properties: { _title: { type: 'string', kind: 'content', default: 'Go' } },
            shared: { tone: {}, variant: {} },
            events: ['press']
        })
    },
    toolbar: { tier: 'root', tag: 'ui-toolbar', shape: shapeOf({ properties: { align: { type: 'string', default: 'start' } } }) },
    form: { tier: 'root', tag: 'ui-form', shape: shapeOf({ properties: { note: { type: 'string', default: '' } }, events: ['submitted'] }) },
    modal: {
        tier: 'root',
        tag: 'ui-modal',
        shape: shapeOf({
            properties: {
                _title: { type: 'string', kind: 'content', default: 'Title' },
                width: { type: 'string', default: 'md', values: ['sm', 'md', 'lg'] },
                body: { type: 'node' },
                footer: { type: 'node' }
            }
        })
    }
};

const FILE = 'composed/confirm-dialog/confirm-dialog.composed.json';

/** The component spec's `confirmDialog` file */
function confirmDialog(): Record<string, unknown> {
    return {
        component: 'modal',
        width: 'sm',
        _title: 'Are you sure?',
        body: { component: 'text', _text: 'This cannot be undone.' },
        footer: {
            component: 'toolbar',
            align: 'end',
            children: {
                cancel: { component: 'button', variant: 'ghost', _title: 'Cancel', on: { press: { command: 'close', target: '^confirmDialog' } } },
                confirm: { component: 'button', tone: 'danger', _title: 'Delete', on: { press: [{ command: 'close', target: '^confirmDialog' }] } }
            }
        },
        exposes: {
            _title: 'Dialog title',
            'body._text': 'The question',
            'footer.children.confirm._title': 'Confirm button text',
            'footer.children.confirm.tone': 'Confirm button tone',
            'footer.children.confirm.on.press': 'What confirming does (a list that replaces the default whole: keep the close command first)'
        }
    };
}

function check(json: Record<string, unknown>) {
    const parsed = parseComposed(json, FILE);
    return { parsed, errors: [...parsed.errors, ...checkComposedExposes(parsed, LIBRARY, FILE)] };
}

describe('parseComposed', () => {
    it('should separate the default tree from the exposes map', () => {
        const { parsed, errors } = check(confirmDialog());

        expect(errors).toEqual([]);
        expect(parsed.tree).not.toHaveProperty('exposes');
        expect(parsed.tree).toMatchObject({ component: 'modal', width: 'sm', _title: 'Are you sure?' });
        expect(parsed.exposes.map((entry) => entry.path)).toEqual([
            '_title',
            'body._text',
            'footer.children.confirm._title',
            'footer.children.confirm.tone',
            'footer.children.confirm.on.press'
        ]);
        expect(parsed.exposes[1]).toEqual({ path: 'body._text', description: 'The question' });
    });

    it('should accept a file without exposes', () => {
        const { exposes: _exposes, ...rest } = confirmDialog();

        const { parsed, errors } = check(rest);

        expect(errors).toEqual([]);
        expect(parsed.exposes).toEqual([]);
    });

    it('should report SUI-BUILD-EXPOSES with the file for a path that resolves nowhere', () => {
        const json = confirmDialog();
        (json.exposes as Record<string, string>)['footer.children.confirm.colour'] = 'Colour';

        const { errors } = check(json);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 'SUI-BUILD-EXPOSES', file: FILE });
        expect(errors[0]?.message).toContain('footer.children.confirm.colour');
    });

    it('should report a path through a node the tree does not have', () => {
        const json = confirmDialog();
        (json.exposes as Record<string, string>)['header._title'] = 'Header';

        expect(check(json).errors.map((error) => error.code)).toEqual(['SUI-BUILD-EXPOSES']);
    });

    it.each([[''], ['   ']])('should report an empty description %j', (description) => {
        const json = confirmDialog();
        (json.exposes as Record<string, string>)._title = description;

        const { errors } = check(json);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 'SUI-BUILD-EXPOSES', file: FILE });
        expect(errors[0]?.message).toContain('needs a description');
    });

    it('should report a description that is not a string', () => {
        const json = confirmDialog();
        (json.exposes as Record<string, unknown>)._title = 5;

        expect(check(json).errors.map((error) => error.code)).toEqual(['SUI-BUILD-EXPOSES']);
    });

    it('should report an exposes value that is not an object', () => {
        const json = { ...confirmDialog(), exposes: ['_title'] };

        expect(check(json).errors.map((error) => error.code)).toEqual(['SUI-BUILD-EXPOSES']);
    });

    it('should report a file that is not a tree as SUI-BUILD-SHAPE', () => {
        expect(parseComposed([], 'a.composed.json').errors.map((error) => error.code)).toEqual(['SUI-BUILD-SHAPE']);
        expect(parseComposed({ exposes: {} }, 'a.composed.json').errors.map((error) => error.code)).toEqual(['SUI-BUILD-SHAPE']);
    });
});

describe('exposed paths', () => {
    const tree = parseComposed(confirmDialog(), 'x').tree as Node;
    const resolved = resolveNode(tree, LIBRARY, {}, { path: '$' }).node;

    it('should accept an exposed on.press path', () => {
        expect(exposedPathResolves(resolved, 'footer.children.confirm.on.press', LIBRARY)).toBe(true);
    });

    it('should accept a property or event the nested shape declares though the tree lacks it', () => {
        expect(exposedPathResolves(resolved, 'footer.children.confirm.size', LIBRARY)).toBe(false);
        expect(exposedPathResolves(resolved, 'footer.children.cancel.tone', LIBRARY)).toBe(true);
        expect(exposedPathResolves(resolved, 'footer.children.cancel.on.press', LIBRARY)).toBe(true);
        expect(exposedPathResolves(resolved, 'footer.children.cancel.on.release', LIBRARY)).toBe(false);
    });

    it('should accept body.children on a form body that has no children yet', () => {
        const dialog = { component: 'modal', body: { component: 'form' } } as Node;
        const form = resolveNode(dialog, LIBRARY, {}, { path: '$' }).node;

        expect(exposedPathResolves(form, 'body.children', LIBRARY)).toBe(true);
        expect(exposedPathResolves(form, 'body.on.submitted', LIBRARY)).toBe(true);
        expect(exposedPathResolves(form, 'body.children.name', LIBRARY)).toBe(false);
    });

    it('should accept a path inside a nested composed component', () => {
        const library: ComponentLibrary = { ...LIBRARY, confirmDialog: { tier: 'composed', tree } };
        const outer = { component: 'confirmDialog', _title: 'Delete?' } as Node;

        expect(checkExposes({ 'footer.children.confirm._title': 'Confirm text' }, outer, library)).toEqual([]);
    });

    it('should reject empty segments', () => {
        expect(exposedPathResolves(resolved, 'body..text', LIBRARY)).toBe(false);
        expect(exposedPathResolves(resolved, '', LIBRARY)).toBe(false);
    });
});

describe('overriding a path that is not exposed', () => {
    it('should let the merge apply it', () => {
        const parsed = parseComposed(confirmDialog(), 'x');
        const library: ComponentLibrary = { ...LIBRARY, confirmDialog: { tier: 'composed', tree: parsed.tree as Node } };

        const result = resolveNode({ component: 'confirmDialog', width: 'lg', footer: { align: 'start' } }, library);

        expect(parsed.exposes.map((entry) => entry.path)).not.toContain('width');
        expect(result.errors).toEqual([]);
        expect(result.node).toMatchObject({ component: 'modal', width: 'lg', footer: { align: 'start' } });
        expect(result.node).not.toHaveProperty('exposes');
    });
});
