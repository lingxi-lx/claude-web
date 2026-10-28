// A plugin package is untrusted input. This module turns .zip / .tar.gz bytes into a flat set of relative paths and
// writes them below one staging folder: no absolute paths, no `..`, no drive letters, no device names, no links,
// bounded entry count and bounded inflated size. Nothing here imports / executes what it extracts.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { isSafeRelativePath, resolvePluginPath } from './manifest.js';
import { readZip } from '../import/zip.js';
import { tr } from '../i18n/index.js';

export const PLUGIN_ARCHIVE_MAX_ENTRY = 8 * 1024 * 1024;
export const PLUGIN_ARCHIVE_MAX_TOTAL = 32 * 1024 * 1024;
export const PLUGIN_ARCHIVE_MAX_FILES = 2000;

export interface PluginArchiveLimits {
  maxEntry?: number;
  maxTotal?: number;
  maxFiles?: number;
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** `./foo` → `foo` (`tar -c .` writes that prefix); backslashes are separators too. */
export function normalizeArchiveName(name: string): string {
  let rel = name.replace(/\\/g, '/');
  while (rel.startsWith('./')) rel = rel.slice(2);
  return rel;
}

/** A path that may be written below the staging folder. Stricter than `isSafeRelativePath` (Windows names / ADS). */
export function isSafeArchivePath(name: string): boolean {
  const rel = normalizeArchiveName(name);
  if (!isSafeRelativePath(rel)) return false;
  if (rel.includes(':')) return false;
  for (const part of rel.split('/')) {
    if (/[. ]$/.test(part)) return false;
    if (RESERVED.test(part)) return false;
  }
  return true;
}

export const isZipBytes = (b: Buffer): boolean => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
export const isGzipBytes = (b: Buffer): boolean => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

const unsafe = (name: string) => new Error(tr('插件包里有不安全的路径：{path}', { path: name.slice(0, 200) }));
const duplicate = (name: string) => new Error(tr('插件包里有重复的文件：{path}', { path: name.slice(0, 200) }));
const tooMany = () => new Error(tr('插件包里的文件太多'));

function readZipEntries(buf: Buffer, o: Required<PluginArchiveLimits>): Map<string, Buffer> {
  const bad: string[] = [];
  let raw: Map<string, Buffer>;
  try {
    raw = readZip(buf, {
      maxEntry: o.maxEntry,
      maxTotal: o.maxTotal,
      want: (name) => {
        if (!isSafeArchivePath(name)) { bad.push(name); return false; }
        return true;
      },
    });
  } catch (e) {
    const msg = (e as Error).message;
    throw new Error(/large/i.test(msg) ? tr('插件包里的文件太大') : tr('插件包已损坏：{why}', { why: msg }));
  }
  if (bad.length) throw unsafe(bad[0]);
  if (raw.size > o.maxFiles) throw tooMany();
  const out = new Map<string, Buffer>();
  for (const [name, data] of raw) {
    const rel = normalizeArchiveName(name);
    if (out.has(rel)) throw duplicate(rel);
    out.set(rel, data);
  }
  return out;
}

const cstr = (b: Buffer, start: number, len: number): string => {
  const s = b.subarray(start, start + len);
  const z = s.indexOf(0);
  return (z >= 0 ? s.subarray(0, z) : s).toString('utf8');
};

function readTarGzEntries(buf: Buffer, o: Required<PluginArchiveLimits>): Map<string, Buffer> {
  let tar: Buffer;
  try {
    tar = zlib.gunzipSync(buf, { maxOutputLength: o.maxTotal + 4 * 1024 * 1024 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new Error(code === 'ERR_BUFFER_TOO_LARGE' ? tr('插件包里的文件太大') : tr('插件包已损坏：{why}', { why: (e as Error).message }));
  }
  const out = new Map<string, Buffer>();
  let off = 0;
  let total = 0;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const stored = parseInt(cstr(h, 148, 8).trim() || '0', 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (!Number.isFinite(stored) || stored !== sum) throw new Error(tr('插件包已损坏：{why}', { why: 'tar checksum' }));
    const prefix = cstr(h, 345, 155);
    const name = (prefix ? `${prefix}/` : '') + cstr(h, 0, 100);
    const size = parseInt(cstr(h, 124, 12).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0 || off + 512 + size > tar.length) throw new Error(tr('插件包已损坏：{why}', { why: 'tar size' }));
    const type = h[156] === 0 ? '\0' : String.fromCharCode(h[156]);
    off += 512;
    if (type === '5') {
      off += Math.ceil(size / 512) * 512;
      continue;
    }
    if (type === 'x' || type === 'g' || type === 'L' || type === 'K') {
      off += Math.ceil(size / 512) * 512;
      continue;
    }
    if (type !== '0' && type !== '\0' && type !== '7') throw new Error(tr('插件包里有不支持的条目'));
    const rel = normalizeArchiveName(name).replace(/\/+$/, '');
    if (!rel || rel === '.') throw new Error(tr('插件包已损坏：{why}', { why: 'tar name' }));
    if (!isSafeArchivePath(rel)) throw unsafe(rel);
    if (out.has(rel)) throw duplicate(rel);
    if (out.size >= o.maxFiles) throw tooMany();
    if (size > o.maxEntry) throw new Error(tr('插件包里的文件太大'));
    total += size;
    if (total > o.maxTotal) throw new Error(tr('插件包里的文件太大'));
    out.set(rel, Buffer.from(tar.subarray(off, off + size)));
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

/** Drop one shared top-level folder (`repo-main/plugin.json` → `plugin.json`). */
function stripCommonRoot(files: Map<string, Buffer>): Map<string, Buffer> {
  const names = [...files.keys()];
  if (!names.length || names.some((n) => !n.includes('/'))) return files;
  const root = names[0].split('/')[0];
  if (!root || !names.every((n) => n.startsWith(`${root}/`))) return files;
  return new Map(names.map((n) => [n.slice(root.length + 1), files.get(n)!]));
}

/** A package whose plugin.json sits one folder down, with other files at the root: keep that folder's subtree. */
function rootFromManifest(files: Map<string, Buffer>): Map<string, Buffer> {
  if (files.has('plugin.json')) return files;
  const candidates = [...files.keys()].filter((n) => n.endsWith('/plugin.json'));
  if (candidates.length !== 1) return files;
  const prefix = candidates[0].slice(0, -'plugin.json'.length);
  const out = new Map<string, Buffer>();
  for (const [name, data] of files) if (name.startsWith(prefix)) out.set(name.slice(prefix.length), data);
  return out;
}

/** Every file of a zip / tar.gz package, keyed by a safe relative path. Throws with a showable message. */
export function extractPluginArchive(buf: Buffer, limits: PluginArchiveLimits = {}): Map<string, Buffer> {
  const o: Required<PluginArchiveLimits> = {
    maxEntry: limits.maxEntry ?? PLUGIN_ARCHIVE_MAX_ENTRY,
    maxTotal: limits.maxTotal ?? PLUGIN_ARCHIVE_MAX_TOTAL,
    maxFiles: limits.maxFiles ?? PLUGIN_ARCHIVE_MAX_FILES,
  };
  if (isZipBytes(buf)) return rootFromManifest(stripCommonRoot(readZipEntries(buf, o)));
  if (isGzipBytes(buf)) return rootFromManifest(stripCommonRoot(readTarGzEntries(buf, o)));
  throw new Error(tr('插件包不是 zip 或 tar.gz'));
}

/** Write the extracted tree below `dir` (paths were validated above; `wx` refuses any overwrite). */
export async function writePluginTree(dir: string, files: Map<string, Buffer>): Promise<void> {
  for (const [rel, data] of files) {
    const target = resolvePluginPath(dir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.writeFile(target, data, { flag: 'wx', mode: 0o644 });
    } catch (e) {
      throw new Error(tr('插件包里的文件冲突：{path}', { path: rel.slice(0, 200) }));
    }
  }
}
