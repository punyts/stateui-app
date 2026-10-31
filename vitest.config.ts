import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        globals: true,
        include: ['src/**/*.test.ts'],
        exclude: [...configDefaults.exclude, 'src/**/*.browser.test.ts']
    }
});
