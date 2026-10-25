// 发布 (stage F5): the pure half. A published page is a snapshot directory served at `/p/<id>/` with no app token,
// sandboxed (no same-origin: it can't reach the app's storage or interface). Everything that decides what is served —
// the id, the expiry, whether a requested path stays inside the snapshot — lives here and is unit-tested.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isSecretFile } from '../files/secret-name.js';

export type PublishExpiry = '1d' | '7d' | 'never';

const DAY = 86_400_000;

export const PUBLISH_HEADERS: Record<string, string> = {
  'Content-Security-Policy': 'sandbox allow-scripts allow-popups',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

export const newPublishId = () => crypto.randomBytes(16).toString('hex');
export const isPublishId = (s: string) => /^[0-9a-f]{32}$/.test(s);

export function expiresAt(e: PublishExpiry, now: number): number | null {
  if (e === '1d') return now + DAY;
  if (e === '7d') return now + 7 * DAY;
  return null;
}

export const isExpired = (item: { expiresAt: number | null }, now: number) => item.expiresAt !== null && item.expiresAt <= now;

const inside = (root: string, p: string) => p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/**
 * The real file `rel` names inside `root`, or null: `..` segments, NUL, absolute / drive paths, anything that resolves
 * (or, through a symlink / junction, really is) outside, a directory or a missing file.
 */
export function resolveInside(root: string, rel: string): string | null {
  let s: string;
  try { s = decodeURIComponent(rel); } catch { return null; }
  if (!s || s.includes('\0')) return null;
  s = s.replace(/\\/g, '/');
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s) || path.isAbsolute(s)) return null;
  if (s.split('/').some((seg) => seg === '..')) return null;
  const abs = path.resolve(root, s);
  if (!inside(path.resolve(root), abs)) return null;
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(abs);
    if (!inside(realRoot, real)) return null;
    if (!fs.statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

/** A relative reference fit to follow (no scheme, no `//`, no `#`, no root-absolute), query / hash cut; else null. */
function relRef(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.startsWith('#') || v.startsWith('//') || v.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  return v.replace(/[?#].*$/, '') || null;
}

/** A reference that may be copied along with the page (relative, not a key / credentials file, not in a dot-folder); else null. */
export function assetRef(raw: string): string | null {
  const r = relRef(raw);
  if (!r || isSecretFile(r) || r.split('/').some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..')) return null;
  return r;
}

/** `<link rel=…>` kinds that load a resource the page itself shows (not a link to another page). */
const ASSET_LINK = /(^|\s)(stylesheet|icon|shortcut|apple-touch-icon|preload|modulepreload|manifest)(\s|$)/i;
/** Tags whose `src` is another page, not an asset of this one. */
const PAGE_SRC = /^(iframe|frame)$/i;

/**
 * The page's own assets, in order: `src` of scripts / images / media (`poster` too) and `href` of stylesheet / icon
 * links. Never `<a href>` or an iframe's page (fix wave F7: a link to `notes.txt` or `../.env` is not part of the page),
 * and never a file whose name says key / credentials, or anything under a dot-folder (`.git/…`).
 */
export function localRefs(html: string): string[] {
  const out: string[] = [];
  const push = (raw: string | undefined) => { const r = raw === undefined ? null : assetRef(raw); if (r) out.push(r); };
  const tags = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
  for (let t = tags.exec(html); t; t = tags.exec(html)) {
    const name = t[1].toLowerCase();
    const attrs = t[2];
    const attr = (a: string) => new RegExp(`(?:^|\\s)${a}\\s*=\\s*["']([^"']+)["']`, 'i').exec(attrs)?.[1];
    if (name === 'link') {
      if (ASSET_LINK.test(attr('rel') ?? '')) push(attr('href'));
      continue;
    }
    if (!PAGE_SRC.test(name)) push(attr('src'));
    if (name === 'video') push(attr('poster'));
  }
  return out;
}

const MAX_FILES = 200;
const MAX_BYTES = 50 * 1024 * 1024;

const isHtml = (f: string) => /\.html?$/i.test(f);
const rel = (root: string, p: string) => path.relative(root, p).split(path.sep).join('/');

/** The file itself plus the local files its page refers to, all inside its folder (relative, `/`-separated). */
export function snapshotFiles(file: string): string[] {
  const dir = path.dirname(file);
  const realDir = fs.realpathSync(dir);
  const out = [path.basename(file)];
  if (!isHtml(file)) return out;
  let bytes = fs.statSync(file).size;
  const seen = new Set(out);
  for (const r of localRefs(fs.readFileSync(file, 'utf8'))) {
    const real = resolveInside(dir, r);
    if (!real) continue;
    const name = rel(realDir, real);
    if (seen.has(name)) continue;
    const size = fs.statSync(real).size;
    if (out.length >= MAX_FILES || bytes + size > MAX_BYTES) break;
    bytes += size;
    seen.add(name);
    out.push(name);
  }
  return out;
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.avif': 'image/avif' };
export const mimeOf = (f: string): string => ({
  ...MIME, '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
}[path.extname(f).toLowerCase()] ?? 'application/octet-stream');

/** One page with its local css, scripts and pictures inlined (other references left as they are). */
export function inlineHtml(file: string): string {
  const dir = path.dirname(file);
  const read = (ref: string) => { const p = resolveInside(dir, ref.replace(/[?#].*$/, '')); return p ? { p, buf: fs.readFileSync(p) } : null; };
  const safeTag = (s: string, tag: string) => s.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1');
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const f = href && assetRef(href) ? read(href) : null;
    return f ? `<style>${safeTag(f.buf.toString('utf8'), 'style')}</style>` : tag;
  });
  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src, b) => {
    const f = assetRef(src) ? read(src) : null;
    return f ? `<script${`${a}${b}`.replace(/\s+$/, '')}>${safeTag(f.buf.toString('utf8'), 'script')}</script>` : tag;
  });
  html = html.replace(/(<(?:img|source|video|audio)\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi, (all, pre, q, src) => {
    const f = assetRef(src) ? read(src) : null;
    return f ? `${pre}${q}data:${mimeOf(f.p).split(';')[0]};base64,${f.buf.toString('base64')}${q}` : all;
  });
  return html;
}
