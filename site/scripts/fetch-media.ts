// The theme showcase's recordings → site/dist/themes/ (spec §5.2), after `astro build`, before the budget check.
// They live on the repo's `site-media` pre-release, not in git; site/media.json lists each with its sha256.
// A file that downloads but does not match fails the build; a file that cannot be reached (after two retries) is a
// warning — the showcase shows its poster, or a placeholder, instead — so the site still builds without the network.
//   node site/scripts/fetch-media.ts
//   SITE_MEDIA=off       skip (CI checks on pull requests)
//   SITE_MEDIA_DIR=<dir> copy from a local folder, relative to site/ (stand-ins: .media-local)
//   SITE_MEDIA_STRICT=1  a file that cannot be reached fails the build too (the Pages deploy, site.yml)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface MediaEntry { sha256: string; bytes: number }
export interface MediaManifest { repo: string; tag: string; webmCodecs: string; files: Record<string, MediaEntry> }
/** a file's bytes, or null when it cannot be had */
export type Source = (file: string) => Promise<Buffer | null>;

export const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

export function dirSource(dir: string): Source {
  return async (file) => {
    const f = path.join(dir, file);
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  };
}

export function releaseSource(m: MediaManifest, base = 'https://github.com'): Source {
  return async (file) => {
    try {
      const r = await fetch(`${base}/${m.repo}/releases/download/${m.tag}/${encodeURIComponent(file)}`, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    } catch {
      return null;
    }
  };
}

/** A source that asks again, `retries` more times, when the answer is null: after backoffMs, then twice that, … */
export function retrying(source: Source, retries = 2, backoffMs = 2000, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Source {
  return async (file) => {
    for (let i = 0; ; i++) {
      const b = await source(file);
      if (b || i >= retries) return b;
      await wait(backoffMs * 2 ** i);
    }
  };
}

export async function fetchMedia(m: MediaManifest, out: string, source: Source, cache?: string, warn: (s: string) => void = console.warn, strict = false): Promise<{ copied: string[]; missing: string[] }> {
  fs.mkdirSync(out, { recursive: true });
  // posters first: they are what shows while the rest arrive
  const names = Object.keys(m.files).sort((a, b) => Number(b.endsWith('.webp')) - Number(a.endsWith('.webp')) || a.localeCompare(b));
  const copied: string[] = [];
  const missing: string[] = [];
  const bad: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < names.length) {
      const name = names[next++];
      const want = m.files[name];
      const cached = cache ? path.join(cache, name) : null;
      let buf: Buffer | null = null;
      if (cached && fs.existsSync(cached)) {
        const b = fs.readFileSync(cached);
        if (sha256(b) === want.sha256) buf = b;
      }
      if (!buf) {
        buf = await source(name);
        if (!buf) { missing.push(name); continue; }
        if (sha256(buf) !== want.sha256 || buf.length !== want.bytes) { bad.push(name); continue; }
        if (cache && cached) { fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(cached, buf); }
      }
      fs.writeFileSync(path.join(out, name), buf);
      copied.push(name);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (bad.length) throw new Error(`site media: sha256 mismatch for ${bad.sort().join(', ')} (site/media.json and the site-media release disagree)`);
  if (missing.length && strict) throw new Error(`site media: ${missing.length} of ${names.length} files unreachable (SITE_MEDIA_STRICT=1): ${missing.sort().join(', ')}`);
  if (missing.length) warn(`site media: ${missing.length} of ${names.length} files unreachable; the showcase shows a poster or a placeholder for them: ${missing.sort().slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`);
  return { copied: copied.sort(), missing: missing.sort() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (process.env.SITE_MEDIA === 'off') {
    console.log('site media: SITE_MEDIA=off, skipped');
  } else {
    const m = JSON.parse(fs.readFileSync(path.join(site, 'media.json'), 'utf8')) as MediaManifest;
    const local = process.env.SITE_MEDIA_DIR;
    const source = local ? dirSource(path.resolve(site, local)) : retrying(releaseSource(m));
    fetchMedia(m, path.join(site, 'dist', 'themes'), source, path.join(site, '.media-cache'), console.warn, process.env.SITE_MEDIA_STRICT === '1').then(
      (r) => console.log(`site media: ${r.copied.length} files in dist/themes/ (${r.missing.length} missing)`),
      (e: Error) => { console.error(e.message); process.exit(1); },
    );
  }
}
