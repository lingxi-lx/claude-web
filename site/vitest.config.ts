import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@i18n': path.resolve(import.meta.dirname, '../server/src/i18n/core.ts') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 30_000,
  },
});
