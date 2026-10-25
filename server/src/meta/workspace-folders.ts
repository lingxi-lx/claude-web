// A project's extra folders (stage C2): stored on the workspace as `folders` (never the main `path`), read with
// `folders ?? []` — old meta.json files need no migration. Pure.
import path from 'node:path';

const key = (p: string, caseless: boolean) => {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return caseless ? s.toLowerCase() : s;
};

export const sameDir = (a: string, b: string, caseless = process.platform === 'win32') => !!a && !!b && key(a, caseless) === key(b, caseless);

export function normFolders(main: string, folders: unknown, o: { caseless?: boolean; resolve?: (p: string) => string } = {}): string[] {
  const caseless = o.caseless ?? process.platform === 'win32';
  const resolve = o.resolve ?? ((p: string) => path.resolve(p));
  if (!Array.isArray(folders)) return [];
  const seen = new Set<string>([key(main, caseless)]);
  const out: string[] = [];
  for (const f of folders) {
    if (typeof f !== 'string' || !f.trim()) continue;
    const p = resolve(f.trim());
    const k = key(p, caseless);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** The extra folders a conversation in `cwd` gets: only in a project's main folder (as the page's `projectFor`). */
export function projectFolders(cwd: string, workspaces: readonly { path: string; folders?: unknown }[], caseless = process.platform === 'win32'): string[] {
  if (!cwd) return [];
  const w = workspaces.find((x) => sameDir(cwd, x.path, caseless));
  return w ? normFolders(w.path, w.folders, { caseless, resolve: (p) => p }) : [];
}
