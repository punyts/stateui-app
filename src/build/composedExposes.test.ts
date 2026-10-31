import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLibrary } from './index.js';

const temporary: string[] = [];

async function folder(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'stateui-app-exposes-'));
    temporary.push(dir);
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), text, 'utf8');
    }
    return dir;
}

afterEach(async () => {
    for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

function root(name: string, shape: Record<string, unknown>): Record<string, string> {
    return {
        [`atoms/${name}/${name}.view.html`]: '<p></p>',
        [`atoms/${name}/${name}.state.json`]: JSON.stringify({ summary: `The ${name}`, ...shape })
    };
}

const ROOTS: Record<string, string> = {
    ...root('text', { properties: { _text: { type: 'string', kind: 'content', default: 'Text' } } }),
    ...root('button', {
        properties: { _title: { type: 'string', kind: 'content', default: 'Go' } },
        shared: { tone: {}, variant: {} },
        events: ['press']
    }),
    ...root('toolbar', { properties: { align: { type: 'string', default: 'start' } } }),
    ...root('modal', {
        properties: {
            _title: { type: 'string', kind: 'content', default: 'Title' },
            width: { type: 'string', default: 'md', values: ['sm', 'md', 'lg'] },
            body: { type: 'node' },
            footer: { type: 'node' }
        }
    })
};

const EXPOSES = {
    _title: 'Dialog title',
    'body._text': 'The question',
    'footer.children.confirm._title': 'Confirm button text',
    'footer.children.confirm.tone': 'Confirm button tone',
    'footer.children.confirm.on.press': 'What confirming does (a list that replaces the default whole: keep the close command first)'
};

/** The component spec's `confirmDialog` file */
function confirmDialog(exposes: Record<string, unknown> = EXPOSES): string {
    return JSON.stringify({
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
        exposes
    });
}

const FILE = 'composites/confirm-dialog/confirm-dialog.composed.json';

async function build(exposes: Record<string, unknown> = EXPOSES) {
    const source = await folder({ ...ROOTS, [FILE]: confirmDialog(exposes) });
    const out = await folder({});
    return { result: await buildLibrary(source, out), out };
}

describe('composed exposes in the build', () => {
    it('should list the exposed paths in the catalog entry and keep them out of the tree', async () => {
        const { result, out } = await build();

        const written = JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8')) as { components: Record<string, unknown>[] };
        const entry = written.components.find((component) => component.name === 'confirmDialog') as { exposes: unknown; tree: Record<string, unknown> };
        expect(result.errors).toEqual([]);
        expect(entry.exposes).toEqual(Object.entries(EXPOSES).map(([path, description]) => ({ path, description })));
        expect(entry.tree).not.toHaveProperty('exposes');
        expect(entry.tree).toMatchObject({ component: 'modal', width: 'sm' });
    });

    it('should report SUI-BUILD-EXPOSES with the file for a bad path and leave the component out', async () => {
        const { result } = await build({ ...EXPOSES, 'footer.children.confirm.colour': 'Colour' });

        expect(result.errors.map((error) => [error.code, error.file])).toEqual([['SUI-BUILD-EXPOSES', FILE]]);
        expect(result.catalog.components.map((component) => component.name)).not.toContain('confirmDialog');
    });

    it('should report SUI-BUILD-EXPOSES with the file for a missing description', async () => {
        const { result } = await build({ ...EXPOSES, _title: '' });

        expect(result.errors.map((error) => [error.code, error.file])).toEqual([['SUI-BUILD-EXPOSES', FILE]]);
    });

    it('should accept an exposed on.press path', async () => {
        const { result } = await build({ 'footer.children.confirm.on.press': 'What confirming does' });

        expect(result.errors).toEqual([]);
    });

    it('should leave exposes out of the entry when the file lists none', async () => {
        const source = await folder({ ...ROOTS, [FILE]: JSON.stringify({ component: 'text' }) });
        const out = await folder({});

        const result = await buildLibrary(source, out);

        expect(result.errors).toEqual([]);
        expect(result.catalog.components.find((component) => component.name === 'confirmDialog')).not.toHaveProperty('exposes');
    });
});
