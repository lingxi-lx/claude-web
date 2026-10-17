import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readFileSync, readdirSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Small, read-mostly helpers for the CLI's own transcript `<config>/projects/<dir>/<id>.jsonl`. Both engines write the
 * same file, but not quite the same way — what matters across an engine switch lives here.
 */

const projectsDir = () => path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects');

/** The transcript of `sessionId` in any project folder, or null (a conversation that never ran a turn has none). */
export function findClaudeTranscript(sessionId: string): string | null {
  const projects = projectsDir();
  let dirs: string[];
  try { dirs = readdirSync(projects); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(projects, d, `${sessionId}.jsonl`);
    if (existsSync(f)) return f;
  }
  return null;
}

/** Whether the CLI has a transcript for this id (`--resume` of one it lacks fails "No conversation found…"). */
export function hasClaudeTranscript(sessionId: string): boolean {
  return findClaudeTranscript(sessionId) !== null;
}

/** Lines of `file` from the end; `visit` returns true to stop. Reads 1 MiB at a time — a long conversation is 60 MB. */
function scanBack(file: string, visit: (line: string, at: number) => boolean, maxBytes = Infinity): void {
  let fd: number;
  try { fd = openSync(file, 'r'); } catch { return; }
  try {
    const CHUNK = 1 << 20;
    let pos = fstatSync(fd).size;
    let carry = Buffer.alloc(0);
    const stop = Math.max(0, pos - maxBytes);
    while (pos > stop) {
      const n = Math.min(CHUNK, pos - stop);
      pos -= n;
      const buf = Buffer.alloc(n);
      readSync(fd, buf, 0, n, pos);
      const all = Buffer.concat([buf, carry]);
      let end = all.length;
      for (let i = all.length - 1; i >= 0; i--) {
        if (all[i] !== 0x0a) continue;
        const line = all.subarray(i + 1, end).toString('utf8');
        end = i;
        if (line.trim() && visit(line, pos + i + 1)) return; // `all` starts at byte `pos` of the file
      }
      carry = all.subarray(0, end);
    }
    const first = carry.toString('utf8');
    if (first.trim() && stop === 0) visit(first, 0); // a cut-off line at the limit is not a line
  } finally {
    closeSync(fd);
  }
}

const parse = (line: string): any => { try { return JSON.parse(line); } catch { return null; } };

/**
 * The running totals the official binary restores when it resumes this transcript: it saves a `cost-state` after every
 * turn and continues counting from the last one (ccb 2.8.4 neither writes nor reads it). Null when there is none.
 */
export function lastCostState(file: string | null, sessionId: string): { cost: number; models: Record<string, Record<string, number>> } | null {
  if (!file) return null;
  let found: any = null;
  scanBack(file, (line) => {
    if (!line.includes('"cost-state"')) return false;
    const e = parse(line);
    if (e?.type !== 'cost-state' || (e.sessionId && e.sessionId !== sessionId)) return false;
    found = e;
    return true;
  });
  if (!found || typeof found.totalCostUSD !== 'number') return null;
  const models: Record<string, Record<string, number>> = {};
  for (const [m, u] of Object.entries<any>(found.modelUsage ?? {})) models[m] = Object.fromEntries(Object.entries(u ?? {}).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
  return { cost: found.totalCostUSD, models };
}

/** Whether an entry with this uuid is in the transcript (looked for from the end, where a fresh one is). */
export function hasEntry(file: string | null, uuid: string): boolean {
  if (!file) return false;
  let found = false;
  scanBack(file, (line) => (found = line.includes(uuid) && parse(line)?.uuid === uuid), 4 << 20);
  return found;
}

/**
 * The uuid of the last message a person typed (not a tool result, not the CLI's own meta / command / compaction lines),
 * or null. Tells a turn written by someone else apart from the entries a process writes around its own turns.
 */
export function lastHumanPrompt(file: string | null): string | null {
  if (!file) return null;
  let found: string | null = null;
  scanBack(file, (line) => {
    if (!line.includes('"user"')) return false;
    const e = parse(line);
    if (e?.type !== 'user' || e.isMeta || e.isSidechain || e.isCompactSummary || typeof e.uuid !== 'string') return false;
    const c = e.message?.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some((b: any) => b?.type === 'tool_result') ? c.find((b: any) => b?.type === 'text')?.text : undefined;
    if (typeof text !== 'string' || text.trimStart().startsWith('<')) return false; // <command-name>, <local-command-…>
    found = e.uuid;
    return true;
  });
  return found;
}

/**
 * The official binary resumes at the `leafUuid` of the last `last-prompt` entry. ccb writes `last-prompt` without one,
 * so after turns on ccb the official binary picked up the conversation from before them and they were gone for good
 * (the next turn branched off the old leaf; 2026-10-01, real relays: BF → XY on ccb → back to BF). Appends a
 * `last-prompt` pointing at the newest entry of the conversation when the last one points elsewhere. True if it wrote.
 *
 * `ignoreLeavesFrom`: a byte offset; leaves written from there on do not count. The official binary writes its own
 * idea of the leaf as it exits — closing an idle one because a terminal took the conversation over (`wroteElsewhere`)
 * put a stale leaf AFTER the terminal's turns, and the next resume branched them off again.
 */
export function repairLeaf(file: string | null, sessionId: string, opts: { ignoreLeavesFrom?: number } = {}): boolean {
  if (!file) return false;
  const ignoreFrom = opts.ignoreLeavesFrom ?? Infinity;
  let leaf: string | undefined; // the newest chain entry after the last counted leaf (main conversation, not a subagent's)
  let pointed: string | undefined; // what the last counted last-prompt with a leaf points at
  let newestLeaf: string | undefined; // what the last last-prompt with a leaf in the whole file points at
  let lastPrompt: string | undefined;
  scanBack(file, (line, at) => {
    if (line.includes('"last-prompt"')) {
      const e = parse(line);
      if (e?.type !== 'last-prompt') return false;
      if (lastPrompt === undefined && typeof e.lastPrompt === 'string') lastPrompt = e.lastPrompt;
      if (typeof e.leafUuid !== 'string') return false;
      newestLeaf ??= e.leafUuid;
      if (at >= ignoreFrom) return false;
      pointed = e.leafUuid; // the last counted one decides
      return true;
    }
    if (!leaf && line.includes('"uuid"')) {
      const e = parse(line);
      if (e && typeof e.uuid === 'string' && 'parentUuid' in e && e.isSidechain !== true) leaf = e.uuid;
    }
    return false;
  });
  // no entry after the last leaf: the official binary wrote it last (a /rewind in the terminal included) — it stands;
  // never pointed anywhere (and nothing ignored): the CLI takes the newest entry itself
  const target = leaf ?? pointed;
  if (!target || newestLeaf === undefined || newestLeaf === target) return false;
  try {
    appendFileSync(file, `${JSON.stringify({ type: 'last-prompt', lastPrompt: lastPrompt ?? '', leafUuid: target, sessionId })}\n`);
    return true;
  } catch {
    return false;
  }
}

/** A text block with nothing to read: the API refuses one (and one with cache_control on it) in any message. */
const emptyText = (b: any) => b?.type === 'text' && typeof b.text === 'string' && !b.text.trim();

/**
 * Takes empty text blocks out of a transcript's messages (2026-10-17: a message that was only a picture went out as
 * [image, text ""] — every later turn of that conversation was refused with 400 「cache_control cannot be set for empty
 * text blocks」 / 「text content blocks must be non-empty」, for good: the engine sends its history again each time).
 * A message left with nothing gets a placeholder. Only while no process has the file (before a resume); the file is
 * rewritten through a temporary one, and not at all when there is nothing to fix. Returns how many messages changed.
 */
export function dropEmptyText(file: string | null): number {
  if (!file) return 0;
  let text: string;
  try {
    // a quick look first: the usual transcript has no empty text at all
    if (statSync(file).size > 512 * 1024 * 1024) return 0;
    text = readFileSync(file, 'utf8');
  } catch { return 0; }
  if (!/"text":"\s*"/.test(text)) return 0;
  let changed = 0;
  const lines = text.split('\n').map((line) => {
    if (!/"text":"\s*"/.test(line)) return line;
    let e: any;
    try { e = JSON.parse(line); } catch { return line; }
    const c = e?.message?.content;
    if ((e?.type !== 'user' && e?.type !== 'assistant') || !Array.isArray(c) || !c.some(emptyText)) return line;
    const kept = c.filter((b: any) => !emptyText(b));
    e.message.content = kept.length ? kept : [{ type: 'text', text: '…' }];
    changed++;
    return JSON.stringify(e);
  });
  if (!changed) return 0;
  const tmp = `${file}.cw-${process.pid}.tmp`;
  try {
    writeFileSync(tmp, lines.join('\n'));
    renameSync(tmp, file);
    return changed;
  } catch {
    try { if (existsSync(tmp)) renameSync(tmp, `${tmp}.failed`); } catch { /* left behind */ }
    return 0;
  }
}
