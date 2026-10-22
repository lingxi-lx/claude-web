import { defineConfig } from 'vitest/config';
import { engineAlias, engineI18n } from './engine.config.mjs';

export default defineConfig({
  resolve: { alias: engineAlias(import.meta.dirname) },
  plugins: [engineI18n(import.meta.dirname)],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 30_000,
  },
});
