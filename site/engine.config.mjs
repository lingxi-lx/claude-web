// The café engine on the site (docs/superpowers/plans/2026-10-22-site-2-hero.md): the same aliases as web/vite.config.ts
// for the files the site bundles, '@/i18n' to the site's shim, and the characters' core's '../../i18n/index.js' (the
// server's i18n, which registers the server's 110 KB English) to the same shim. Shared by astro.config.mjs and vitest.config.ts.
import path from 'node:path';

const slash = (p) => p.replaceAll('\\', '/');

export function engineAlias(site) {
  const repo = path.resolve(site, '..');
  return [
    { find: /^@i18n$/, replacement: slash(path.join(repo, 'server/src/i18n/core.ts')) },
    { find: /^@\/i18n$/, replacement: slash(path.join(site, 'src/hero/engine-i18n.ts')) },
    { find: /^@cafe\//, replacement: `${slash(path.join(repo, 'web/src/features/cafe'))}/` },
    { find: /^@characters$/, replacement: slash(path.join(repo, 'server/src/characters/core/index.ts')) },
    { find: /^@shared$/, replacement: slash(path.join(repo, 'server/src/protocol.ts')) },
  ];
}

export function engineI18n(site) {
  const core = path.normalize(path.join(path.resolve(site, '..'), 'server/src/characters/core'));
  const shim = slash(path.join(site, 'src/hero/engine-i18n.ts'));
  return {
    name: 'site-engine-i18n',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === '../../i18n/index.js' && importer && path.normalize(importer.split('?')[0]).startsWith(core)) return shim;
      return null;
    },
  };
}
