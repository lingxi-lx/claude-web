// 项目页 (stage F2): which project a conversation belongs to, the block its instructions add to the system prompt, the
// sessions tools' project scope and where a project's files live. Pure.
import path from 'node:path';
import { sameDir } from './workspace-folders.js';

export interface ProjectLike { id: string; path: string; name: string; instructions?: string }

export const MAX_INSTRUCTIONS = 20_000;

/** meta.workspaceId first (a worktree conversation), else the project whose main folder is the cwd (or groupCwd). */
export function projectOf<W extends ProjectLike>(s: { cwd?: string; workspaceId?: string; groupCwd?: string }, workspaces: readonly W[], caseless = process.platform === 'win32'): W | undefined {
  if (s.workspaceId) {
    const w = workspaces.find((x) => x.id === s.workspaceId);
    if (w) return w;
  }
  for (const dir of [s.cwd, s.groupCwd]) {
    if (!dir) continue;
    const w = workspaces.find((x) => sameDir(dir, x.path, caseless));
    if (w) return w;
  }
  return undefined;
}

/** The text appended to the system prompt of a conversation in this project ('' = none). */
export function instructionsSection(w: ProjectLike | undefined): string {
  const text = w?.instructions?.trim();
  if (!w || !text) return '';
  const body = text.length > MAX_INSTRUCTIONS ? `${text.slice(0, MAX_INSTRUCTIONS)}\n…` : text;
  return `# Project instructions (${w.name})\nThe user set these for every conversation in this project:\n\n${body}`;
}

/** Project scope of the sessions tools: the same project; a caller outside every project sees only the outside. */
export const inProjectScope = (self: string | undefined, target: string | undefined) => (self ?? '') === (target ?? '');

export function projectFilesDir(dataDir: string, workspaceId: string): string {
  if (!/^[\w-]+$/.test(workspaceId)) throw new Error('bad project id');
  return path.join(dataDir, 'projects', workspaceId);
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A plain file name for the project's files folder, or null. */
export function safeProjectFile(name: string): string | null {
  if (typeof name !== 'string') return null;
  const n = name.trim();
  if (!n || n.length > 200 || /[<>:"/\\|?*\u0000-\u001f]/.test(n) || /^\.+$/.test(n) || n.endsWith('.') || n.endsWith(' ') || RESERVED.test(n)) return null;
  return n;
}
