import { describe, expect, it } from 'vitest';
import { VERSION } from './index.js';

describe('package entry point in a browser', () => {
    it('exports the version', () => {
        expect(VERSION).toBe('0.1.0');
        expect(typeof document).toBe('object');
    });
});
