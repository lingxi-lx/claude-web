// Plugin sandbox policy (spec §8.15): a plugin gets nothing it did not declare.
//  - network: default none; only the hosts in `permissions.network` (exact or `*.example.com`) are reachable;
//  - files: default none; reads only from `fileRead`, writes only to `fileWrite`; the runtime additionally grants
//    read-only access to the plugin's own folder (`ownDir: true`), matching its child-process permission flags.
// `check(host, path)` is the one call the fetch bridge / fs bridge uses: it returns a reason the UI can show,
// and it always denies a path that resolves outside an allow-listed root (traversal, absolute escapes, NUL).
import path from 'node:path';
import type { PluginPermissions } from './protocol.js';
import { hasTraversal, isAbsolutePathLike, isHostPattern, isPathInside, isSafePermissionPath } from './manifest.js';
import { tr } from '../i18n/index.js';

export type SandboxMode = 'read' | 'write';

export interface SandboxOptions {
  /** the plugin's own folder; nothing in it is allowed unless `ownDir: true` */
  root?: string;
  /** grant read-only access to `root` (the runtime turns this on; the default policy grants nothing) */
  ownDir?: boolean;
}

export type SandboxDecision =
  | { ok: true }
  | { ok: false; code: 'network' | 'fs' | 'invalid'; message: string };

/** Lower-case a hostname and strip one trailing dot; null for anything that is not a bare host. */
export function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  if (!s || s.length > 253 || s.includes('\0')) return null;
  if (/^\[[0-9a-f:.]+\]$/.test(s)) return s;
  if (s.includes('://') || /[\s/\\@?#]/.test(s) || s.includes(':')) return null;
  if (s.endsWith('.')) s = s.slice(0, -1);
  if (!s || s.includes('..')) return null;
  return s;
}

/** `example.com` matches exactly; `*.example.com` matches one or more labels below it (never the apex); `*` any. */
export function hostAllowed(host: string, allow: string[] = []): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  return allow.some((raw) => {
    const pattern = String(raw).trim().toLowerCase().replace(/\.$/, '');
    if (pattern === '*') return true;
    if (!pattern) return false;
    if (pattern.startsWith('*.')) return h.endsWith(pattern.slice(1)) && h.length > pattern.length - 1;
    return h === pattern;
  });
}

function resolveGrant(entry: string, root: string | undefined): string {
  if (!isSafePermissionPath(entry)) throw new Error(tr('插件权限里的路径不能跳出插件目录：{path}', { path: entry.slice(0, 200) }));
  return isAbsolutePathLike(entry) ? path.resolve(entry) : path.resolve(root ?? process.cwd(), entry);
}

function resolveTarget(target: string, root: string | undefined): string | null {
  if (typeof target !== 'string' || !target.trim() || target.includes('\0')) return null;
  if (hasTraversal(target)) {
    // a relative path with `..` may still be legitimate only if it stays under a root; resolving decides below
    if (!isAbsolutePathLike(target)) {
      const base = root ?? process.cwd();
      return path.resolve(base, target);
    }
    return null;
  }
  return isAbsolutePathLike(target) ? path.resolve(target) : path.resolve(root ?? process.cwd(), target);
}

/** One plugin's declared permissions, ready to answer `may I reach this host / touch this path`. */
export class PluginSandbox {
  readonly network: string[];
  readonly readRoots: string[];
  readonly writeRoots: string[];
  readonly root: string | undefined;

  constructor(rules: PluginPermissions = {}, opts: SandboxOptions = {}) {
    this.root = opts.root ? path.resolve(opts.root) : undefined;
    this.network = [];
    for (const raw of rules.network ?? []) {
      if (!isHostPattern(raw)) throw new Error(tr('插件网络权限不合法：{host}', { host: String(raw).slice(0, 120) }));
      const pattern = raw.trim().toLowerCase();
      if (!this.network.includes(pattern)) this.network.push(pattern);
    }

    const read: string[] = [];
    if (this.root && opts.ownDir === true) read.push(this.root);
    for (const p of rules.fileRead ?? []) {
      const abs = resolveGrant(p, this.root);
      if (!read.includes(abs)) read.push(abs);
    }
    this.readRoots = read;

    const write: string[] = [];
    for (const p of rules.fileWrite ?? []) {
      const abs = resolveGrant(p, this.root);
      if (!write.includes(abs)) write.push(abs);
    }
    this.writeRoots = write;
  }

  allowsHost(host: string): boolean { return hostAllowed(host, this.network); }

  /** Boolean form of `check` for callers that do not need the reason. */
  allows(host?: string | null, target?: string, mode: SandboxMode = 'read'): boolean {
    return this.check(host, target, mode).ok;
  }

  allowsPath(target: string, mode: SandboxMode = 'read'): boolean {
    const abs = resolveTarget(target, this.root);
    if (!abs) return false;
    const roots = mode === 'write' ? this.writeRoots : this.readRoots;
    return roots.some((root) => isPathInside(root, abs));
  }

  /** Both checks in one call; omit `host` to check only a file, omit `target` to check only a host. */
  check(host?: string | null, target?: string, mode: SandboxMode = 'read'): SandboxDecision {
    if (host !== undefined && host !== null && String(host).trim() !== '') {
      const normalized = normalizeHost(host);
      if (!normalized) return { ok: false, code: 'invalid', message: tr('网络地址不合法：{host}', { host: String(host).slice(0, 120) }) };
      if (!this.allowsHost(normalized)) return { ok: false, code: 'network', message: tr('这个插件没有访问 {host} 的网络权限', { host: normalized }) };
    }
    if (target !== undefined) {
      if (!this.allowsPath(target, mode)) {
        return {
          ok: false,
          code: 'fs',
          message: mode === 'write'
            ? tr('这个插件没有写 {path} 的权限', { path: String(target).slice(0, 200) })
            : tr('这个插件没有读 {path} 的权限', { path: String(target).slice(0, 200) }),
        };
      }
    }
    return { ok: true };
  }

  assertHost(host: string): void {
    const r = this.check(host);
    if (!r.ok) throw new Error(r.message);
  }

  assertPath(target: string, mode: SandboxMode = 'read'): void {
    const r = this.check(undefined, target, mode);
    if (!r.ok) throw new Error(r.message);
  }
}

export function createSandbox(rules: PluginPermissions = {}, opts: SandboxOptions = {}): PluginSandbox {
  return new PluginSandbox(rules, opts);
}
