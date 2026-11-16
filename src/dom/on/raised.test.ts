import { createStore } from '@punyts/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRaisedRecorder, HOVER_THROTTLE_MS, raisedPath, raisedValue, usesRaisedHover } from './raised.js';

const NODE = '$.app.children.save';
const RAISED_SAVE = '$.raised.app.children.save';
const RAISED_SAVE_PRESS = `${RAISED_SAVE}.press`;
const RAISED_SAVE_HOVER = `${RAISED_SAVE}.hover`;

function heard(store: ReturnType<typeof createStore>, path: string): unknown[] {
    const values: unknown[] = [];
    store.on(path, (_path, value) => values.push(JSON.parse(JSON.stringify(value))));
    return values;
}

describe('raisedPath', () => {
    it('should keep the events in their own branch, by the node path', () => {
        expect(raisedPath('$.screens.home.children.save', 'press')).toBe('$.raised.screens.home.children.save.press');
    });
});

describe('raisedValue', () => {
    it('should be true for an event without data, the payload for one with, and leave out a drawing\'s shape path', () => {
        expect(raisedValue(undefined)).toBe(true);
        expect(raisedValue(null)).toBe(true);
        expect(raisedValue('r12')).toBe('r12');
        expect(raisedValue({ shape: '$.app.children.d.children.s', key: 'k1', x: 3, y: 4 })).toEqual({ key: 'k1', x: 3, y: 4 });
        expect(raisedValue({ shape: '$.app.children.d.children.s' })).toBe(true);
        expect(raisedValue({ fn: () => 1, n: 2 })).toEqual({ n: 2 });
    });
});

describe('usesRaisedHover', () => {
    it('should find a hover in $.raised, or a pattern step that matches it, anywhere in the document', () => {
        expect(usesRaisedHover({ logic: { rules: { r: { when: { path: RAISED_SAVE_HOVER } } } } })).toBe(true);
        expect(usesRaisedHover({ logic: { rules: { r: { when: { path: '$.raised.screens.home.children.{n}.*' } } } } })).toBe(true);
        expect(usesRaisedHover({ app: { component: 'text', '<-_text': `${RAISED_SAVE_HOVER}.key` } })).toBe(true);
        expect(usesRaisedHover({ logic: { rules: { r: { when: { path: RAISED_SAVE_PRESS } } } } })).toBe(false);
        expect(usesRaisedHover({ app: { component: 'text', _text: 'hovered' } })).toBe(false);
        expect(usesRaisedHover({ logic: { rules: { r: { when: { path: '$.screens.home.children.hover' } } } } })).toBe(false);
    });
});

describe('createRaisedRecorder', () => {
    let store: ReturnType<typeof createStore>;

    beforeEach(() => {
        store = createStore<unknown>({ app: { children: { save: { component: 'button' }, list: { component: 'list' } } } });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should write each press into raised, every time, also when the value repeats', () => {
        // Arrange
        const recorder = createRaisedRecorder(store as never, { hover: false });
        recorder.record('press', undefined, NODE);
        const presses = heard(store, RAISED_SAVE_PRESS);

        // Act
        recorder.record('press', undefined, NODE);
        recorder.record('press', undefined, NODE);

        // Assert: the node itself is not touched
        expect(store.get(RAISED_SAVE)).toEqual({ press: true });
        expect(store.get(NODE)).toEqual({ component: 'button' });
        expect(presses).toEqual([true, true]);
    });

    it('should keep the events of a node apart and write a data event\'s payload', () => {
        const recorder = createRaisedRecorder(store as never, { hover: false });

        recorder.record('activate', 'r1', '$.app.children.list');
        recorder.record('sort', { by: 'name', direction: 'asc' }, '$.app.children.list');
        recorder.record('activate', 'r2', '$.app.children.list');

        expect(store.get('$.raised.app.children.list')).toEqual({ activate: 'r2', sort: { by: 'name', direction: 'asc' } });
    });

    it('should not write the events whose result already is state', () => {
        const recorder = createRaisedRecorder(store as never, { hover: true });

        for (const event of ['change', 'input', 'valid', 'invalid', 'changed', 'query']) recorder.record(event, 'x', NODE);

        expect(store.get(RAISED_SAVE)).toBeUndefined();
    });

    it('should not write hover when nothing uses it', () => {
        const recorder = createRaisedRecorder(store as never, { hover: false });

        recorder.record('hover', { key: 'k1' }, NODE);

        expect(store.get(RAISED_SAVE)).toBeUndefined();
    });

    it('should write hover at most once per throttle window, the last one landing when it ends', () => {
        // Arrange
        vi.useFakeTimers();
        let time = 1_000;
        const recorder = createRaisedRecorder(store as never, { hover: true, now: () => time });
        recorder.record('hover', { key: 'a' }, NODE);
        const hovers = heard(store, RAISED_SAVE_HOVER);

        // Act: three more in the window, then the window ends
        for (const key of ['b', 'c', 'd']) {
            time += 50;
            recorder.record('hover', { key }, NODE);
        }
        const inWindow = [...hovers];
        time += HOVER_THROTTLE_MS;
        vi.advanceTimersByTime(HOVER_THROTTLE_MS);

        // Assert
        expect(inWindow).toEqual([]);
        expect(hovers).toEqual([{ key: 'd' }]);
        expect(store.get(RAISED_SAVE_HOVER)).toEqual({ key: 'd' });
    });

    it('should drop the pending hover when it is disposed', () => {
        vi.useFakeTimers();
        let time = 1_000;
        const recorder = createRaisedRecorder(store as never, { hover: true, now: () => time });
        recorder.record('hover', { key: 'a' }, NODE);
        time += 10;
        recorder.record('hover', { key: 'b' }, NODE);

        recorder.dispose();
        vi.advanceTimersByTime(HOVER_THROTTLE_MS);

        expect(store.get(RAISED_SAVE_HOVER)).toEqual({ key: 'a' });
    });
});
