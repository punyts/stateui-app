import { describe, expect, it } from 'vitest';
import { mountSteps, registerMountStep } from './steps.js';

describe('registerMountStep', () => {
    it('should list steps in registration order and keep the place of a replaced one', () => {
        // Arrange
        const first = {};
        const second = {};
        const replacement = {};
        const removers = [registerMountStep('a', first), registerMountStep('b', second)];

        // Act
        registerMountStep('a', replacement);

        // Assert
        expect(mountSteps()).toEqual([
            ['a', replacement],
            ['b', second]
        ]);
        for (const remove of removers) remove();
        registerMountStep('a', replacement)();
    });

    it('should remove a step with the function it returns and ignore a stale one', () => {
        // Arrange
        const old = {};
        const current = {};
        const removeOld = registerMountStep('c', old);
        const removeCurrent = registerMountStep('c', current);

        // Act
        removeOld();
        const kept = mountSteps().length;
        removeCurrent();

        // Assert
        expect(kept).toBe(1);
        expect(mountSteps()).toEqual([]);
    });
});
