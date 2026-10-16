// 生成的文件 across conversations (spec 2026-10-16 pages §6): the files Claude wrote with Write / Artifact in the recent
// conversations on this computer — the kinds worth looking at again (pages, documents, pictures, data), the ones still
// on disk, newest first, each with the conversation it came from.
import fs from 'node:fs';
import path from 'node:path';
import type { ArtifactRef, SessionSummary } from '../protocol.js';

const KINDS = new Set(['.html', '.htm', '.md', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.csv']);

/** The paths a transcript's Write / Artifact calls produced, in order (a path written twice counts at its last time). */
export function writtenPaths(messages: any[]): { path: string; at: number }[] {
  const out = new Map<string, number>();
  for (const m of messages) {
    if (m?.type !== 'assistant' || !Array.isArray(m.message?.content)) continue;
    const at = Date.parse(m.timestamp ?? '') || 0;
    for (const b of m.message.content) {
      if (b?.type !== 'tool_use') continue;
      const p = b.name === 'Write' ? b.input?.file_path : b.name === 'Artifact' ? b.input?.path ?? b.input?.file_path : undefined;
      if (typeof p === 'string' && KINDS.has(path.extname(p).toLowerCase())) { out.delete(p); out.set(p, at); }
    }
  }
  return [...out].map(([p, at]) => ({ path: p, at }));
}

interface Lib { list(): Promise<SessionSummary[]>; read(id: string): Promise<{ messages: any[] }> }

export async function recentArtifacts(lib: Lib, o: { sessions?: number; limit?: number } = {}): Promise<ArtifactRef[]> {
  const recent = (await lib.list())
    .filter((s) => !s.peer && (s.agent ?? 'claude') === 'claude')
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, o.sessions ?? 50);
  const found = new Map<string, ArtifactRef>();
  for (const s of recent) {
    let msgs: any[] = [];
    try { msgs = (await lib.read(s.sessionId)).messages; } catch { continue; }
    for (const w of writtenPaths(msgs)) {
      const abs = path.isAbsolute(w.path) ? w.path : path.join(s.cwd || '', w.path);
      const prev = found.get(abs);
      if (prev && prev.at >= w.at) continue;
      found.set(abs, { path: abs, sessionId: s.sessionId, title: s.customTitle || s.title || '', at: w.at || s.lastModified });
    }
  }
  return [...found.values()].filter((a) => fs.existsSync(a.path)).sort((a, b) => b.at - a.at).slice(0, o.limit ?? 100);
}
