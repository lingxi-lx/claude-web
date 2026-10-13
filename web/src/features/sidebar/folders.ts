// The sidebar's 文件夹 section (2026-10-14 user report: wanted every folder on its own, the way Claude's own app lists
// them, not everything under the one big parent folder). Pure: Sidebar.tsx passes what it has.
import { basename } from '@/util';

/** Folders listed open, most recently used first; the rest wait under 「更早的文件夹」. */
export const FOLDERS_SHOWN = 10;

/** The folders with conversations, already newest first: the ones shown and the older ones. */
export function splitFolders<T>(folders: readonly T[], shown = FOLDERS_SHOWN): { recent: T[]; older: T[] } {
  return { recent: folders.slice(0, shown), older: folders.slice(shown) };
}

const lastTwo = (p: string): [string, string] => {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]+/).filter(Boolean);
  return [parts.at(-1) ?? p, parts.at(-2) ?? ''];
};

/**
 * What each folder is called in the list: its own name, and — when another folder or a project has the same name — its
 * parent folder's after it (`app · shop`, `app · blog`), so two of them never read the same.
 */
export function folderLabels(paths: readonly string[], projectNames: readonly string[] = []): Map<string, string> {
  const count = new Map<string, number>();
  const bump = (n: string) => count.set(n.toLowerCase(), (count.get(n.toLowerCase()) ?? 0) + 1);
  for (const p of paths) bump(lastTwo(p)[0] || basename(p) || p);
  for (const n of projectNames) bump(n);
  const out = new Map<string, string>();
  for (const p of paths) {
    const [name, parent] = lastTwo(p);
    const own = name || basename(p) || p;
    out.set(p, (count.get(own.toLowerCase()) ?? 0) > 1 && parent ? `${own} · ${parent}` : own);
  }
  return out;
}
