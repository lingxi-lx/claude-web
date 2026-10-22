import { defineConfig } from 'astro/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Served by GitHub Pages on the custom domain https://psycioxyxs.my/ (bound in the repo's Pages settings)
export default defineConfig({
  site: 'https://psycioxyxs.my',
  base: '/',
  trailingSlash: 'always',
  output: 'static',
  build: { format: 'directory' },
  vite: {
    resolve: { alias: { '@i18n': path.resolve(here, '../server/src/i18n/core.ts') } },
  },
});
