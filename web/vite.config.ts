import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // relative asset URLs (./assets/…): the phone shell runs the same build below a folder (app/index.html)
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../server/src/protocol.ts'),
      '@catalog': path.resolve(__dirname, '../server/src/models/catalog.ts'),
      '@i18n': path.resolve(__dirname, '../server/src/i18n/core.ts'),
      '@errors': path.resolve(__dirname, '../server/src/errors/explain.ts'),
      // the phone shell's channel code (web-standard APIs only); index.ts, never the core's tests (they use node:*)
      '@anywhere': path.resolve(__dirname, '../server/src/remote/anywhere/core/index.ts'),
      '@characters': path.resolve(__dirname, '../server/src/characters/core/index.ts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: { '/ws': { target: 'ws://127.0.0.1:3090', ws: true }, '/api': 'http://127.0.0.1:3090' },
  },
  build: { outDir: 'dist', sourcemap: false },
  // the source-scanning tests (i18n coverage, wording) read every file: seconds each, more next to a full parallel run;
  // the store tests import the whole store in beforeAll — same budget for the hooks
  test: { environment: 'node', testTimeout: 30_000, hookTimeout: 30_000 },
} as any);
