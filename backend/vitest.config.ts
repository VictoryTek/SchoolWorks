import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['src/__tests__/helpers/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    // Run test files one at a time. All files share one database, and several services use
    // Serializable transactions (checkout, repair tickets), which fail with a write conflict when
    // another file writes the same tables at the same moment. This replaces the old
    // poolOptions.forks.singleFork setting, which Vitest 4 removed (it was silently not applying).
    fileParallelism: false,
    pool: 'forks',
  },
});
