// DeepSeek Harness (dsh): a local history source. Its conversations go on as Claude conversations (any model):
// `continueInClaude` — never through dsh itself, which needs its own DeepSeek key and model.
//
//   ~/.dsh/sessions/<project>/<session dir>/session[.vN].jsonl[.zstd]   the event stream, one file per format generation
//   ~/.dsh/storages/session_projcache/sessions/<session dir>.json        title / cwd / createdAt (the harness's own index)
//   ~/.dsh/attachments/v1/objects/<2 hex>/<sha256>                      pasted images
//
// The stream is zstd with several frames concatenated (one per append), so a single Decompress call returns only the
// first frame. Frames are split on the zstd magic and decoded one by one. Nothing here writes to ~/.dsh.
import fs from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import type { AgentKind, SessionSummary, SourceCaps, SourceStatus } from '../protocol.js';
import type { SessionSource } from './types.js';
import { libraryId } from './ids.js';
import { tr } from '../i18n/index.js';

const CAPS: SourceCaps = { resume: true, rename: false, archive: false, delete: false, fork: false, continueInClaude: true };
const MAX_FILE = 64 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
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

/**
 * The log the harness itself reads in a session directory: the numerically highest format generation
 * (`session.jsonl` is v0, later ones `session.vN.jsonl`; `.zstd` when compressed). An upgrade migrates the old log
 * into a new generation and keeps writing only there — reading the old one froze a conversation at the upgrade
 * (2026-10-22: a v4 file next to the v0 one, the new turns only in v4).
 */
export function pickLog(names: string[]): { name: string; zstd: boolean } | null {
  let best: { name: string; zstd: boolean; v: number } | null = null;
  for (const n of names) {
    const m = /^session(?:\.v([1-9]\d*))?\.jsonl(\.zstd)?$/.exec(n);
    if (!m) continue;
    const v = m[1] ? Number(m[1]) : 0;
    if (!best || v > best.v) best = { name: n, zstd: !!m[2], v };
  }
  return best && { name: best.name, zstd: best.zstd };
}

interface Found { id: string; file: string; zstd: boolean; folder: string }
interface Event { type?: string; seq?: number; time?: number; data?: any; cwd?: string; createdAt?: number; parentSession?: string; origin?: string; delegationDepth?: number }

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b: any) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).filter(Boolean).join('\n');
};

/** An image attachment's bytes, or null (`sha256:<hex>` → `attachments/v1/objects/<hex[0..2]>/<hex>`). */
export type DshImage = (attachmentId: string) => Buffer | null;

export function dshImageReader(home: string): DshImage {
  return (attachmentId) => {
    const hex = /^sha256:([0-9a-f]{64})$/.exec(attachmentId)?.[1];
    if (!hex) return null;
    const file = path.join(home, 'attachments', 'v1', 'objects', hex.slice(0, 2), hex);
    try {
      if (statSync(file).size > MAX_IMAGE) return null;
      return readFileSync(file);
    } catch { return null; }
  };
}

function userBlocks(content: unknown, image?: DshImage): unknown[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  const out: unknown[] = [];
  for (const b of content as any[]) {
    if (b?.type === 'text' && typeof b.text === 'string') out.push({ type: 'text', text: b.text });
    else if (b?.type === 'image') {
      const a = b.attachment ?? {};
      const bytes = typeof a.attachmentId === 'string' ? image?.(a.attachmentId) : null;
      out.push(bytes
        ? { type: 'image', source: { type: 'base64', media_type: String(a.mediaType ?? 'image/png'), data: bytes.toString('base64') } }
        : { type: 'text', text: tr('［图片：{name}］', { name: String(a.name ?? 'image') }) });
    }
  }
  return out;
}

const parseArgs = (s: unknown): unknown => {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(String(s ?? '{}')); } catch { return { arguments: String(s ?? '') }; }
};

/**
 * An assistant message's blocks in the SDK's shape: dsh's `reasoning` is the renderer's `thinking`, its `tool-call`
 * (`{id, name, arguments}`, the same call its separate `tool/call` event repeats) a `tool_use`.
 */
function assistantBlocks(content: unknown, called: Set<string>): unknown[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const out: unknown[] = [];
  for (const b of content as any[]) {
    if (b?.type === 'reasoning') {
      if (String(b.text ?? '').trim()) out.push({ type: 'thinking', thinking: String(b.text), ...(b.signature ? { signature: b.signature } : {}) });
    } else if (b?.type === 'text') {
      if (String(b.text ?? '')) out.push({ type: 'text', text: String(b.text) });
    } else if (b?.type === 'tool-call') {
      const id = String(b.id ?? b.toolCallId ?? '');
      if (id) called.add(id);
      out.push({ type: 'tool_use', id, name: String(b.name ?? b.toolName ?? ''), input: parseArgs(b.arguments ?? b.input) });
    }
  }
  return out;
}

/**
 * A `tool/result` → `tool_result` blocks. Two shapes on disk:
 * - v0: `message.content` is `[{type:'tool-result', toolCallId, content:[{type:'text'}], isError}]`
 * - v4: `message.toolCallId` (and `source.callId`), `message.content` is the result itself `[{type:'text'}]`, `isError`
 */
function toolResults(message: any): unknown[] {
  const blocks: any[] = Array.isArray(message?.content) ? message.content : [];
  const result = (id: unknown, content: unknown, isError: unknown) => ({
    type: 'tool_result',
    tool_use_id: String(id ?? ''),
    content: typeof content === 'string' ? content : textOf(content),
    ...(isError ? { is_error: true } : {}),
  });
  const parts = blocks.filter((b) => b?.type === 'tool-result');
  if (parts.length) return parts.map((b) => result(b.toolCallId ?? b.tool_use_id, b.content, b.isError));
  const id = message?.toolCallId ?? message?.source?.callId;
  return id ? [result(id, blocks, message.isError)] : [];
}

/** A message the user typed (not a tool result riding as a user message). */
const said = (m: any): boolean => m?.type === 'user' && !(m.message?.content ?? []).some((b: any) => b?.type === 'tool_result');

/** The event stream → the SDK-shaped messages the app renders. */
export function dshMessages(events: Event[], sessionId: string, image?: DshImage): any[] {
  const out: any[] = [];
  let n = 0;
  const called = new Set<string>();
  for (const e of events) {
    const d = e?.data ?? {};
    if (e.type === 'user/message') {
      // the harness writes its own injections through the same event: the runtime-context snapshot (cwd, sandbox,
      // approval policy), plugin notes and the skill catalog. They are not what the user said — a history full of them
      // reads like the user pasted a wall of text before every question.
      if (d.source?.kind && d.source.kind !== 'user') continue;
      const content = userBlocks(d.content, image);
      if (!content.length) continue;
      out.push({ type: 'user', uuid: `${sessionId}-${n++}`, session_id: sessionId, message: { role: 'user', content } });
    } else if (e.type === 'assistant/message' && d.message) {
      const content = assistantBlocks(d.message.content, called);
      if (!content.length) continue;
      const { role, id } = d.message;
      out.push({ type: 'assistant', uuid: `${sessionId}-${n++}`, session_id: sessionId, message: { role: role ?? 'assistant', ...(id ? { id } : {}), ...(d.message.source?.model ? { model: d.message.source.model } : {}), content } });
    } else if (e.type === 'tool/call') {
      // the assistant message before it already carried this call as a `tool-call` block
      const id = String(d.callId ?? '');
      if (id && called.has(id)) continue;
      if (id) called.add(id);
      out.push({
        type: 'assistant', uuid: `${sessionId}-${n++}`, session_id: sessionId,
        message: { role: 'assistant', content: [{ type: 'tool_use', id, name: String(d.name ?? ''), input: parseArgs(d.arguments) }] },
      });
    } else if (e.type === 'tool/result') {
      const content = toolResults(d.message);
      if (!content.length) continue;
      out.push({ type: 'user', uuid: `${sessionId}-${n++}`, session_id: sessionId, message: { role: 'user', content } });
    }
  }
  return out;
}

/** What the list needs from one session, kept per log file until it changes. */
interface Info { mtimeMs: number; size: number; cwd?: string; title?: string; createdAt?: number; child: boolean; said: number; first?: string }

export class DshSource implements SessionSource {
  readonly kind: AgentKind = 'dsh';
  /** Read from the files; a send goes on as a Claude conversation seeded with this history (LibraryService.continuation). */
  get caps(): SourceCaps { return { ...CAPS }; }
  private cached: { at: number; found: Found[] } | null = null;
  private infos = new Map<string, Info>();
  private readonly image: DshImage;

  constructor(private readonly home: string = dshHome()) {
    this.image = dshImageReader(home);
  }

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
        // the directory name IS the session id: older sessions are `session-<uuid>`, newer ones the bare `<uuid>`
        const at = path.join(dir, s);
        let log: { name: string; zstd: boolean } | null = null;
        try { log = pickLog(await fs.readdir(at)); } catch { continue; }
        if (!log) continue;
        const file = path.join(at, log.name);
        try { if (!(await fs.stat(file)).isFile()) continue; } catch { continue; }
        out.push({ id: s, file, zstd: log.zstd, folder: p });
        if (out.length >= MAX_SESSIONS) break;
      }
    }
    this.cached = { at: Date.now(), found: out };
    return out;
  }

  private async decode(f: Pick<Found, 'file' | 'zstd'>): Promise<Event[]> {
    const fh = await fs.open(f.file, 'r');
    try {
      const st = await fh.stat();
      const len = Math.min(st.size, MAX_FILE);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, 0);
      const out: Event[] = [];
      for (const line of (f.zstd ? decodeZstdFrames(buf) : buf.toString('utf8')).split('\n')) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line) as Event); } catch { /* a half-written line */ }
      }
      return out;
    } finally {
      await fh.close().catch(() => {});
    }
  }

  /** The harness's own index entry: `record.identity` {cwd, createdAt}, `record.rows.title.val`. */
  private async projcache(id: string): Promise<{ cwd?: string; title?: string; createdAt?: number }> {
    try {
      const j = JSON.parse(await fs.readFile(path.join(this.home, 'storages', 'session_projcache', 'sessions', `${id}.json`), 'utf8'));
      const r = j?.record ?? {};
      const title = r.rows?.title?.val;
      return {
        cwd: typeof r.identity?.cwd === 'string' ? r.identity.cwd : undefined,
        createdAt: typeof r.identity?.createdAt === 'number' ? r.identity.createdAt : undefined,
        title: typeof title === 'string' && title.trim() ? title.trim() : undefined,
      };
    } catch { return {}; }
  }

  /** Decoded once per change of the log: the header, the last title, how many things the user said. */
  private async info(f: Found): Promise<Info | null> {
    const st = await fs.stat(f.file).catch(() => null);
    if (!st) return null;
    const hit = this.infos.get(f.file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    const events = await this.decode(f).catch(() => [] as Event[]);
    const out: Info = { mtimeMs: st.mtimeMs, size: st.size, child: false, said: 0 };
    for (const e of events) {
      if (e.type === 'session') {
        // the header keeps cwd / createdAt at the top level (both the v0 and the v4 logs)
        out.cwd = e.cwd ?? e.data?.cwd ?? out.cwd;
        out.createdAt = e.createdAt ?? e.data?.createdAt ?? out.createdAt;
        // a subagent's own session (delegated work) belongs to its parent conversation, not the list
        out.child = !!(e.parentSession ?? e.data?.parentSession) || (e.origin ?? e.data?.origin) === 'subagent' || Number(e.delegationDepth ?? e.data?.delegationDepth ?? 0) > 0;
      } else if (e.type === 'session/title' && typeof e.data?.title === 'string' && e.data.title.trim()) out.title = e.data.title.trim();
      else if (e.type === 'user/message' && (!e.data?.source?.kind || e.data.source.kind === 'user')) {
        out.said++;
        if (!out.first) out.first = textOf(e.data?.content).trim().split('\n')[0]?.slice(0, 80) || undefined;
      }
    }
    this.infos.set(f.file, out);
    return out;
  }

  async status(): Promise<SourceStatus> {
    const found = await this.found();
    return { kind: this.kind, name: 'DeepSeek Harness', installed: found.length > 0, detected: found.length > 0, joined: false, dismissed: false, enabled: found.length > 0, count: found.length };
  }

  async list(): Promise<{ items: SessionSummary[] }> {
    const found = await this.found();
    const items: SessionSummary[] = [];
    for (const f of found) {
      const h = await this.info(f);
      // nothing said yet (opened and closed, or only the harness's own setup) — nothing to read or go on with
      if (!h || h.child || !h.said) continue;
      const idx = await this.projcache(f.id);
      items.push({
        sessionId: libraryId('dsh', f.id),
        title: idx.title || h.title || h.first || tr('DeepSeek Harness 对话 {id}', { id: f.id.replace(/^session-/, '').slice(0, 8) }),
        cwd: h.cwd || idx.cwd || dshCwd(f.folder),
        lastModified: h.mtimeMs,
        createdAt: h.createdAt ?? idx.createdAt ?? h.mtimeMs,
        agent: this.kind,
        caps: this.caps,
      });
    }
    return { items: items.sort((a, b) => b.lastModified - a.lastModified) };
  }

  async read(nativeId: string, o: { cursor?: string; limit: number } = { limit: 50 }): Promise<{ messages: any[]; next?: string }> {
    const f = (await this.found()).find((x) => x.id === nativeId);
    if (!f) throw new Error(tr('DeepSeek Harness 里找不到这个对话（可能已经删掉了）'));
    const all = dshMessages(await this.decode(f), libraryId('dsh', nativeId), this.image);
    // newest page first, the cursor walking back (the library's contract — readAll reverses the pages); a page starts
    // where the user spoke, so a call and its result are never on two pages
    const end = o.cursor === undefined ? all.length : Math.min(all.length, Math.max(0, Number(o.cursor) || 0));
    let start = Math.max(0, end - Math.max(1, o.limit || 50));
    let turn = start;
    while (turn < end && !said(all[turn])) turn++;
    if (turn < end) start = turn;
    else while (start > 0 && !said(all[start])) start--; // one turn longer than a page: the whole turn
    return { messages: all.slice(start, end), ...(start > 0 ? { next: String(start) } : {}) };
  }

  async close(): Promise<void> { /* files only */ }
}
