// plugin.json validation (spec §8.12): one place that decides what a plugin may declare.
// Everything here is data: an id, a name, a version, hooks and permissions. Paths are checked for traversal
// before they are used to spawn / read anything, and unknown permission keys are refused instead of ignored
// (a silently dropped permission would make the user approve something other than what runs).
import path from 'node:path';
import type { PluginHook, PluginManifest, PluginPermissions } from './protocol.js';
import { tr } from '../i18n/index.js';

export const PLUGIN_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
export const PLUGIN_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
/** Extension points this host knows how to call today (add one here and in protocol.ts together). */
export const PLUGIN_HOOKS: readonly PluginHook[] = ['request-before', 'response-after', 'source-provider'];
export const MAX_PLUGIN_HOOKS = 8;
export const MAX_PLUGIN_NAME = 100;
export const MAX_PLUGIN_VERSION = 40;
export const MAX_PERMISSION_ITEMS = 50;
export const MAX_TIMEOUT_MS = 60_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export const MIN_OUTPUT_BYTES = 1024;
/** the child's V8 heap cap (--max-old-space-size), MB */
export const MIN_MEMORY_MB = 32;
export const MAX_MEMORY_MB = 1024;
export const DEFAULT_MEMORY_MB = 256;

const PERMISSION_KEYS = new Set(['network', 'fileRead', 'fileWrite', 'secrets', 'childProcess', 'workers']);
const SECRET_NAME_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** `C:\…`, `\\server\…` or `/…`: a path that is not relative to the plugin folder. */
export function isAbsolutePathLike(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\/.test(p) || p.startsWith('/') || p.startsWith('\\');
}

/** Any `..` segment, with either separator (Windows clients send `..\`, POSIX ones `../`). */
export function hasTraversal(p: string): boolean {
  return p.split(/[\\/]+/).some((s) => s === '..');
}

/** A relative path that stays under the folder it is resolved against. */
export function isSafeRelativePath(p: unknown): p is string {
  if (typeof p !== 'string') return false;
  const s = p.trim();
  if (!s || s.length > 1024 || s.includes('\0')) return false;
  if (isAbsolutePathLike(s) || /^[A-Za-z]:/.test(s) || s.startsWith('~')) return false;
  if (hasTraversal(s)) return false;
  return s.split(/[\\/]+/).every((part) => part !== '.' && part.length > 0);
}

/** A declared permission path: relative (no traversal) or an explicit absolute grant. */
export function isSafePermissionPath(p: unknown): boolean {
  if (typeof p !== 'string') return false;
  const s = p.trim();
  if (!s || s.length > 1024 || s.includes('\0')) return false;
  if (hasTraversal(s)) return false;
  if (isAbsolutePathLike(s) || /^[A-Za-z]:/.test(s)) return true;
  if (s.startsWith('~')) return false;
  return s.split(/[\\/]+/).every((part) => part !== '.' && part.length > 0);
}

/** Resolve `rel` under `root`; throws instead of ever returning a path outside it. */
export function resolvePluginPath(root: string, rel: string): string {
  if (!isSafeRelativePath(rel)) throw new Error(tr('插件里的文件路径不能跳出插件目录：{path}', { path: String(rel).slice(0, 200) }));
  const base = path.resolve(root);
  const target = path.resolve(base, rel);
  const r = path.relative(base, target);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new Error(tr('插件里的文件路径不能跳出插件目录：{path}', { path: rel.slice(0, 200) }));
  return target;
}

/** `target` is `root` itself or below it (used by the sandbox for allow-list checks). */
export function isPathInside(root: string, target: string): boolean {
  const base = path.resolve(root);
  const p = path.resolve(target);
  const r = path.relative(base, p);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

export function parseHooks(v: unknown): PluginHook[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(tr('插件 hooks 必须是一组名字'));
  if (v.length > MAX_PLUGIN_HOOKS) throw new Error(tr('插件最多声明 {n} 个 hook', { n: MAX_PLUGIN_HOOKS }));
  const out: PluginHook[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string' || !(PLUGIN_HOOKS as readonly string[]).includes(raw)) {
      throw new Error(tr('插件 hooks 里有不认识的名字：{hook}', { hook: String(raw).slice(0, 80) }));
    }
    if (!out.includes(raw as PluginHook)) out.push(raw as PluginHook);
  }
  return out;
}

function stringList(v: unknown, key: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(tr('插件权限 {key} 必须是一组字符串', { key }));
  if (v.length > MAX_PERMISSION_ITEMS) throw new Error(tr('插件权限 {key} 最多 {n} 项', { key, n: MAX_PERMISSION_ITEMS }));
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error(tr('插件权限 {key} 必须是一组字符串', { key }));
    const s = raw.trim();
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** `example.com`, `*.example.com` or `*`; no scheme, port, path or credentials. */
export function isHostPattern(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  if (s === '*') return true;
  if (s.length > 253 || /[\s/\\:@?#]/.test(s) || s.includes('\0')) return false;
  const host = s.startsWith('*.') ? s.slice(2) : s;
  if (!host || host.includes('*')) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.?$/.test(host);
}

export function parsePermissions(v: unknown): PluginPermissions {
  if (v === undefined) return { network: [], fileRead: [], secrets: [] };
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(tr('插件权限必须是一个对象'));
  for (const key of Object.keys(v)) {
    if (!PERMISSION_KEYS.has(key)) throw new Error(tr('不认识的插件权限：{key}', { key: key.slice(0, 40) }));
  }
  const p = v as Record<string, unknown>;
  const network = stringList(p.network, 'network');
  for (const h of network) if (!isHostPattern(h)) throw new Error(tr('插件网络权限不合法：{host}', { host: h.slice(0, 120) }));
  const fileRead = stringList(p.fileRead, 'fileRead');
  for (const f of fileRead) if (!isSafePermissionPath(f)) throw new Error(tr('插件权限里的路径不能跳出插件目录：{path}', { path: f.slice(0, 200) }));
  const fileWrite = stringList(p.fileWrite, 'fileWrite');
  for (const f of fileWrite) if (!isSafePermissionPath(f)) throw new Error(tr('插件权限里的路径不能跳出插件目录：{path}', { path: f.slice(0, 200) }));
  const secrets = stringList(p.secrets, 'secrets');
  for (const s of secrets) if (!SECRET_NAME_RE.test(s)) throw new Error(tr('插件密钥名不合法：{name}', { name: s.slice(0, 80) }));
  for (const key of ['childProcess', 'workers'] as const) {
    if (p[key] !== undefined && typeof p[key] !== 'boolean') throw new Error(tr('插件权限 {key} 只能是 true 或 false', { key }));
  }
  return {
    network,
    fileRead,
    ...(fileWrite.length ? { fileWrite } : {}),
    secrets,
    // OS-level grants (Node's permission model): off unless declared and approved with the rest
    ...(p.childProcess === true ? { childProcess: true } : {}),
    ...(p.workers === true ? { workers: true } : {}),
  };
}

/**
 * One manifest, validated. `fallbackId` is the folder name (older plugin.json files may omit the id).
 * Throws a message meant for the plugin list, never a raw stack.
 */
export function parseManifest(raw: unknown, fallbackId?: string): PluginManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(tr('插件清单必须是一个 JSON 对象'));
  const v = raw as Record<string, unknown>;
  const id = typeof v.id === 'string' ? v.id.trim() : typeof fallbackId === 'string' ? fallbackId.trim() : '';
  if (!id || id.length > 64 || !PLUGIN_ID_RE.test(id)) throw new Error(tr('插件 id 只能包含字母、数字和 _ . -，最多 64 个字符'));
  let name = id;
  if (v.name !== undefined) {
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.trim().length > MAX_PLUGIN_NAME) {
      throw new Error(tr('插件名字不能为空，最多 {n} 个字', { n: MAX_PLUGIN_NAME }));
    }
    name = v.name.trim();
  }
  let version = '0.0.0';
  if (v.version !== undefined) {
    if (typeof v.version !== 'string' || !v.version.trim() || v.version.trim().length > MAX_PLUGIN_VERSION) throw new Error(tr('插件版本号要像 1.2.3'));
    version = v.version.trim();
    if (!PLUGIN_VERSION_RE.test(version)) throw new Error(tr('插件版本号要像 1.2.3'));
  }
  const main = v.main === undefined ? 'index.js' : typeof v.main === 'string' ? v.main.trim() : '';
  if (!main || main.length > 512 || !isSafeRelativePath(main)) throw new Error(tr('插件入口文件不能跳出插件目录'));
  const hooks = parseHooks(v.hooks);
  const permissions = parsePermissions(v.permissions);

  let timeoutMs: number | undefined;
  if (v.timeoutMs !== undefined) {
    if (typeof v.timeoutMs !== 'number' || !Number.isInteger(v.timeoutMs) || v.timeoutMs < MIN_TIMEOUT_MS || v.timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error(tr('插件超时时间要在 {min} 到 {max} 毫秒之间', { min: MIN_TIMEOUT_MS, max: MAX_TIMEOUT_MS }));
    }
    timeoutMs = v.timeoutMs;
  }
  let maxOutputBytes: number | undefined;
  if (v.maxOutputBytes !== undefined) {
    if (typeof v.maxOutputBytes !== 'number' || !Number.isInteger(v.maxOutputBytes) || v.maxOutputBytes < MIN_OUTPUT_BYTES || v.maxOutputBytes > MAX_OUTPUT_BYTES) {
      throw new Error(tr('插件输出上限要在 {min} 到 {max} 字节之间', { min: MIN_OUTPUT_BYTES, max: MAX_OUTPUT_BYTES }));
    }
    maxOutputBytes = v.maxOutputBytes;
  }
  let maxMemoryMb: number | undefined;
  if (v.maxMemoryMb !== undefined) {
    if (typeof v.maxMemoryMb !== 'number' || !Number.isInteger(v.maxMemoryMb) || v.maxMemoryMb < MIN_MEMORY_MB || v.maxMemoryMb > MAX_MEMORY_MB) {
      throw new Error(tr('插件内存上限要在 {min} 到 {max} MB 之间', { min: MIN_MEMORY_MB, max: MAX_MEMORY_MB }));
    }
    maxMemoryMb = v.maxMemoryMb;
  }

  return {
    id,
    name,
    version,
    ...(str(v.description, 300) ? { description: str(v.description, 300) } : {}),
    main,
    hooks,
    permissions,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
    ...(maxMemoryMb !== undefined ? { maxMemoryMb } : {}),
  };
}

/** Non-throwing wrapper for a form / the plugin list: a rejection comes back as a message, not an exception. */
export function validateManifest(raw: unknown, fallbackId?: string): { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] } {
  try {
    return { ok: true, manifest: parseManifest(raw, fallbackId) };
  } catch (e) {
    return { ok: false, errors: [(e as Error).message] };
  }
}

// Readable aliases used by callers that name the object explicitly.
export const parsePluginManifest = parseManifest;
export const validatePluginManifest = validateManifest;
