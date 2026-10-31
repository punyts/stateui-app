import { describe, expect, it } from 'vitest';

const DOM_GLOBALS = ['window', 'document', 'HTMLElement', 'customElements', 'navigator', 'Node'] as const;

describe('core entry point', () => {
    it('exports the version without touching a DOM global', async () => {
        const reads: string[] = [];
        const saved = new Map<string, PropertyDescriptor | undefined>();
        for (const name of DOM_GLOBALS) {
            saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
            Object.defineProperty(globalThis, name, {
                configurable: true,
                get() {
                    reads.push(name);
                    return undefined;
                }
            });
        }

        try {
            const core = await import('./index.js');
            expect(core.VERSION).toBe('0.1.0');
        } finally {
            for (const [name, descriptor] of saved) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else delete (globalThis as Record<string, unknown>)[name];
            }
        }

        expect(reads).toEqual([]);
    });
});
