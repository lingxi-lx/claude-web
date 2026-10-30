// A conversation's name, read from the whole transcript. The SDK's listSessions reads only the first and last 64 KB:
// once a long turn pushes the `custom-title` line (a rename) out of the tail, its summary falls back to the LAST
// prompt, so a renamed conversation showed its latest message as its name — on every list and after a restart
// (2026-10-30 user report: 「对话名会被篡改……被改成对话中的内容了」; on this machine 3 of 71 renamed conversations).
// Each file is read once from the start, then only what was appended (per size); the result is kept on disk.
import fs from 'node:fs';
import path from 'node:path';

export interface Titles { custom?: string; ai?: string }
interface Entry extends Titles { size: number; scanned: number; mtime?: number }

const CHUNK = 1 << 20;
/** Title lines are small; a longer line is a message and is skipped without being kept. */
const MAX_LINE = 64 * 1024;

/** Read `file` from `from` to `to`, updating `e` with the last custom-title / ai-title lines; returns where it stopped. */
function scan(file: string, e: Entry, from: number, to: number): number {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    let pending: Buffer[] = [];
    let pendingLen = 0;
    let skipping = false;
    let lineStart = from;
    for (let pos = from; pos < to; ) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, to - pos), pos);
      if (n <= 0) break;
      let i = 0;
      while (i < n) {
        const nl = buf.indexOf(10, i);
        const end = nl < 0 || nl >= n ? n : nl;
        if (!skipping) {
          if (pendingLen + (end - i) > MAX_LINE) { skipping = true; pending = []; pendingLen = 0; }
          else { pending.push(Buffer.from(buf.subarray(i, end))); pendingLen += end - i; }
        }
        if (end === n) break;
        if (!skipping && pendingLen) take(Buffer.concat(pending).toString('utf8'), e);
        pending = []; pendingLen = 0; skipping = false;
        i = end + 1;
        lineStart = pos + i;
      }
      pos += n;
    }
    // an unfinished last line is read again next time
    return lineStart;
  } finally { fs.closeSync(fd); }
}

function take(line: string, e: Entry) {
  if (!line.includes('-title"')) return;
  let j: any;
  try { j = JSON.parse(line); } catch { return; }
  if (j?.type === 'custom-title' && typeof j.customTitle === 'string') e.custom = j.customTitle;
  else if (j?.type === 'ai-title' && typeof j.aiTitle === 'string') e.ai = j.aiTitle;
}

export class TranscriptTitles {
  private entries = new Map<string, Entry>();
  private dirty = false;
  private saving: NodeJS.Timeout | null = null;

  constructor(private cacheFile?: string) {
    if (!cacheFile) return;
    try {
      const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      for (const [k, v] of Object.entries<any>(raw?.files ?? {})) if (typeof v?.size === 'number' && typeof v?.scanned === 'number') this.entries.set(k, v);
    } catch { /* none yet */ }
  }

  /** What is known for `file` without reading it (undefined: never read). */
  known(file: string): Titles | undefined {
    const e = this.entries.get(file);
    return e && { custom: e.custom, ai: e.ai };
  }

  /** Bring `file` up to date: only the bytes after what was read before (all of it when the file shrank or is new). */
  update(file: string): Titles | undefined {
    let size: number, mtime: number;
    try { const st = fs.statSync(file); size = st.size; mtime = st.mtimeMs; } catch { this.entries.delete(file); return undefined; }
    let e = this.entries.get(file);
    if (e && e.size === size && e.mtime === mtime) return { custom: e.custom, ai: e.ai };
    // shorter, or rewritten to the same size: read again from the start
    if (!e || size < e.scanned || (e.size === size && e.mtime !== mtime)) e = { size: 0, scanned: 0 };
    try { e.scanned = scan(file, e, e.scanned, size); } catch { return this.known(file); }
    e.size = size;
    e.mtime = mtime;
    this.entries.set(file, e);
    this.markDirty();
    return { custom: e.custom, ai: e.ai };
  }

  /** Files never read before (the first run reads everything once, in the background). */
  unread(files: string[]): string[] {
    return files.filter((f) => !this.entries.has(f));
  }

  private markDirty() {
    this.dirty = true;
    if (!this.cacheFile || this.saving) return;
    this.saving = setTimeout(() => { this.saving = null; this.flush(); }, 2000);
    this.saving.unref?.();
  }

  flush() {
    if (!this.cacheFile || !this.dirty) return;
    this.dirty = false;
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      const tmp = `${this.cacheFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, files: Object.fromEntries(this.entries) }));
      fs.renameSync(tmp, this.cacheFile);
    } catch { /* kept in memory; written next time */ }
  }
}
