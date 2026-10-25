// A project's extra folders reach Codex as a `sandbox_workspace_write.writable_roots` config override — and a
// config override REPLACES the value from the user's own config.toml. So the override carries the user's list plus
// ours (C-S1, stage C fix wave): nothing the user made writable for themselves stops being writable in claude-web.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as tomlParse } from 'smol-toml';

/** `$CODEX_HOME`, else `~/.codex` — the same place the Codex CLI (and agent-config/codex.ts) reads. */
export function codexHome(env: Record<string, string | undefined>): string {
  return env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []);

/**
 * The writable roots the user configured: the active profile's `sandbox_workspace_write.writable_roots` when it sets
 * one, else the top-level table's. A missing or unreadable file is no roots (Codex itself reports a broken file).
 */
export async function userWritableRoots(env: Record<string, string | undefined>): Promise<string[]> {
  let doc: any;
  try { doc = tomlParse(await fs.readFile(path.join(codexHome(env), 'config.toml'), 'utf8')); } catch { return []; }
  const profile = typeof doc?.profile === 'string' ? doc.profile : null;
  const fromProfile = profile ? doc?.profiles?.[profile]?.sandbox_workspace_write?.writable_roots : undefined;
  return strings(fromProfile !== undefined ? fromProfile : doc?.sandbox_workspace_write?.writable_roots);
}

/** Union in order, first spelling kept; the same folder twice (trailing separator, and case on Windows) counts once. */
export function unionRoots(lists: string[][], platform: NodeJS.Platform = process.platform): string[] {
  const key = (p: string) => {
    let k = p.replace(/[\\/]+$/, '');
    if (!k) k = p;
    if (platform === 'win32') k = k.replace(/\//g, '\\').toLowerCase();
    return k;
  };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) for (const p of list) {
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}
