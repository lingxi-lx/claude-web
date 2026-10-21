// DeepSeek Harness (dsh): a READ-ONLY local history source.
//
//   ~/.dsh/sessions/<project>/session-<uuid>/session.jsonl.zstd   the event stream (appended frame by frame)
//   ~/.dsh/storages/session_projcache/sessions/session-<uuid>.json  title / cwd / createdAt
//
// The stream is zstd with several frames concatenated (one per append), so a single Decompress call returns only the
// first frame. Frames are split on the zstd magic and decoded one by one. Nothing here writes, renames or resumes.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import type { AgentKind, SessionSummary, SourceCaps, SourceStatus } from '../protocol.js';
import type { SessionSource } from './types.js';
import { libraryId } from './ids.js';
import { tr } from '../i18n/index.js';

const CAPS: SourceCaps = { resume: false, rename: false, archive: false, delete: false, fork: false };
const MAX_FILE = 64 * 1024 * 1024;
const MAX_SESSIONS = 5_000;
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh');
}

/** `--C-Users-YPY-Desktop-dsh--` → `C:\Users\YPY\Desktop\dsh` (the header's own cwd wins when it is read). */
export function dshCwd(folder: string): string {
  const m = /^--(.*)--$/.exec(folder);
  if (!m) return folder;
  const parts = m[1].split('-');
  // the first part is the drive letter: `C-Users-me-demo` → `C:\Users\me\demo` (a `C:\C\…` would be wrong)
  if (parts.length > 1 && /^[A-Za-z]$/.test(parts[0])) return `${parts[0].toUpperCase()}:\\${parts.slice(1).join('\\')}`;
  return parts.join('\\');
}

/** Every frame of a multi-frame zstd file, decoded and joined. */
export function decodeZstdFrames(buf: Buffer): string {
  const at: number[] = [];
  let i = buf.indexOf(MAGIC, 0);
  while (i >= 0) { at.push(i); i = buf.indexOf(MAGIC, i + 4); }
  if (!at.length) {
    try { return zlib.zstdDecompressSync(buf).toString('utf8'); } catch { return ''; }
  }
  const parts: string[] = [];
  for (let k = 0; k < at.length; k++) {
    const slice = buf.subarray(at[k], at[k + 1] ?? buf.length);
    try { parts.push(zlib.zstdDecompressSync(slice).toString('utf8')); } catch { /* a frame still being written */ }
  }
  return parts.join('');
}

interface Found { id: string; file: string; folder: string }
interface Event { type?: string; seq?: number; time?: number; data?: any }

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b: any) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('');
};

/** The event stream → the SDK-shaped messages the app renders (read-only: no writes back to dsh). */
export function dshMessages(events: Event[], sessionId: string): any[] {
  const out: any[] = [];
  let n = 0;
  for (const e of events) {
    const d = e?.data ?? {};
    if (e.type === 'user/message') {
      out.push({ type: 'user', uuid: `${sessionId}-${n++}`, session_id: sessionId, message: { role: 'user', content: d.content ?? [] } });
    } else if (e.type === 'assistant/message' && d.message) {
      out.push({ type: 'assistant', uuid: `${sessionId}-${n++}`, session_id: sessionId, message: d.message });
    } else if (e.type === 'tool/call') {
      let input: unknown = {};
      try { input = JSON.parse(String(d.arguments ?? '{}')); } catch { /* not JSON */ }
      out.push({
        type: 'assistant', uuid: `${sessionId}-${n++}`, session_id: sessionId,
        message: { role: 'assistant', content: [{ type: 'tool_use', id: String(d.callId ?? ''), name: String(d.name ?? ''), input }] },
      });
    } else if (e.type === 'tool/result') {
      const blocks = Array.isArray(d.message?.content) ? d.message.content : [];
      out.push({
        type: 'user', uuid: `${sessionId}-${n++}`, session_id: sessionId,
        message: {
          role: 'user',
          content: blocks.map((b: any) => ({
            type: 'tool_result',
            tool_use_id: String(b?.toolCallId ?? b?.tool_use_id ?? ''),
            content: typeof b?.content === 'string' ? b.content : JSON.stringify(b?.content ?? ''),
            ...(b?.isError ? { is_error: true } : {}),
          })),
        },
      });
    }
  }
  return out;
}

export class DshSource implements SessionSource {
  readonly kind: AgentKind = 'dsh';
  /**
   * Reading is the files; continuing is the agent's own ACP `session/resume` (the AcpDriver resumes it and the new
   * turns go back into the same session log). Everything else stays unsupported: dsh has no fork / delete / load.
   */
  get caps(): SourceCaps { return { ...CAPS, resume: true }; }
  private cached: { at: number; found: Found[] } | null = null;

  constructor(private readonly home: string = dshHome()) {}

  private get sessionsDir() { return path.join(this.home, 'sessions'); }

  private async found(): Promise<Found[]> {
    if (this.cached && Date.now() - this.cached.at < 30_000) return this.cached.found;
    const out: Found[] = [];
    let projects: string[] = [];
    try { projects = await fs.readdir(this.sessionsDir); } catch { /* not installed */ }
    for (const p of projects) {
      const dir = path.join(this.sessionsDir, p);
      let sessions: string[] = [];
      try { sessions = await fs.readdir(dir); } catch { continue; }
      for (const s of sessions) {
        // the directory name IS the id `session/list` / `session/resume` use: older sessions are `session-<uuid>`,
        // sessions the harness creates now are the bare `<uuid>`; dropping or re-adding a prefix breaks resume.
        // The log is `session.jsonl.zstd` in older ones and `session.v4.jsonl.zstd` in newer ones.
        const at = path.join(dir, s);
        let file: string | undefined;
        try {
          const names = await fs.readdir(at);
          const hit = names.find((n) => /^session(\.[\w.-]+)?\.jsonl\.zstd$/.test(n));
          if (hit) file = path.join(at, hit);
        } catch { continue; }
        if (!file) continue;
        try { if (!(await fs.stat(file)).isFile()) continue; } catch { continue; }
        out.push({ id: s, file, folder: p });
        if (out.length >= MAX_SESSIONS) break;
      }
    }
    this.cached = { at: Date.now(), found: out };
    return out;
  }

  private async decode(file: string): Promise<Event[]> {
    const fh = await fs.open(file, 'r');
    try {
      const st = await fh.stat();
      const len = Math.min(st.size, MAX_FILE);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, 0);
      const out: Event[] = [];
      for (const line of decodeZstdFrames(buf).split('\n')) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line) as Event); } catch { /* a half-written line */ }
      }
      return out;
    } finally {
      await fh.close().catch(() => {});
    }
  }

  private async header(file: string): Promise<{ cwd?: string; title?: string; createdAt?: number }> {
    // the first frame holds the session header; the rest can wait
    const fh = await fs.open(file, 'r');
    try {
      const st = await fh.stat();
      const len = Math.min(st.size, 64 * 1024);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, 0);
      const text = decodeZstdFrames(buf);
      let cwd: string | undefined;
      let title: string | undefined;
      let createdAt: number | undefined;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          // the session header keeps cwd / createdAt at the top level (both the old and the v4 logs)
          const e = JSON.parse(line) as Event & { cwd?: string; createdAt?: number };
          if (e.type === 'session') { cwd = e.cwd ?? e.data?.cwd ?? cwd; createdAt = e.createdAt ?? e.data?.createdAt ?? createdAt; }
          if (e.type === 'session/title') title = String(e.data?.title ?? title ?? '');
        } catch { /* partial */ }
      }
      return { cwd, title, createdAt };
    } finally {
      await fh.close().catch(() => {});
    }
  }

  async status(): Promise<SourceStatus> {
    const found = await this.found();
    return { kind: this.kind, name: 'DeepSeek Harness', installed: found.length > 0, detected: found.length > 0, joined: false, dismissed: false, enabled: found.length > 0, count: found.length };
  }

  async list(): Promise<{ items: SessionSummary[] }> {
    const found = await this.found();
    const items: SessionSummary[] = [];
    for (const f of found) {
      const st = await fs.stat(f.file).catch(() => null);
      if (!st) continue;
      const h = await this.header(f.file).catch(() => ({}) as { cwd?: string; title?: string; createdAt?: number });
      items.push({
        sessionId: libraryId('dsh', f.id),
        title: h.title?.trim() || tr('DeepSeek Harness 对话 {id}', { id: f.id.replace(/^session-/, '').slice(0, 8) }),
        cwd: h.cwd || dshCwd(f.folder),
        lastModified: st.mtimeMs,
        createdAt: h.createdAt ?? st.birthtimeMs ?? st.mtimeMs,
        agent: this.kind,
        caps: CAPS,
      });
    }
    return { items: items.sort((a, b) => b.lastModified - a.lastModified) };
  }

  async read(nativeId: string, o: { cursor?: string; limit: number } = { limit: 50 }): Promise<{ messages: any[]; next?: string }> {
    const f = (await this.found()).find((x) => x.id === nativeId);
    if (!f) throw new Error(tr('DeepSeek Harness 里找不到这个对话（可能已经删掉了）'));
    const all = dshMessages(await this.decode(f.file), libraryId('dsh', nativeId));
    const start = Math.max(0, Number(o.cursor ?? 0) || 0);
    const size = Math.max(1, o.limit || 50);
    const next = start + size < all.length ? String(start + size) : undefined;
    return { messages: all.slice(start, start + size), ...(next ? { next } : {}) };
  }

  async close(): Promise<void> { /* files only */ }
}
