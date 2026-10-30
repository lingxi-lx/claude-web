import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Small, read-mostly helpers for the CLI's own transcript `<config>/projects/<dir>/<id>.jsonl`. Both engines write the
 * same file, but not quite the same way — what matters across an engine switch lives here.
 */

const projectsDir = () => path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'projects');

/** stage E5: the projects folders of WSL distros a conversation ran in (`\\wsl.localhost\<distro>\home\…\.claude\projects`). */
const extraRoots: { dir: string; distro: string }[] = [];

export function addTranscriptRoot(dir: string, distro: string): void {
  if (!dir || extraRoots.some((r) => r.dir.toLowerCase() === dir.toLowerCase())) return;
  extraRoots.push({ dir, distro });
}

/** This computer's projects folder, then the distros'. */
export function transcriptRoots(): { dir: string; distro?: string }[] {
  return [{ dir: projectsDir() }, ...extraRoots];
}

/** The transcript of `sessionId` in any project folder (WSL distros' too), or null (one that never ran a turn has none). */
export function findClaudeTranscript(sessionId: string): string | null {
  for (const root of transcriptRoots()) {
    let dirs: string[];
    try { dirs = readdirSync(root.dir); } catch { continue; }
    for (const d of dirs) {
      const f = path.join(root.dir, d, `${sessionId}.jsonl`);
      if (existsSync(f)) return f;
    }
  }
  return null;
}

/** Whether the CLI has a transcript for this id (`--resume` of one it lacks fails "No conversation found…"). */
export function hasClaudeTranscript(sessionId: string): boolean {
  return findClaudeTranscript(sessionId) !== null;
}

/** The CLI's project folder for a cwd — its own rule: every non-alphanumeric char a `-`, past 200 chars a hash suffix. */
export function claudeProjectDir(cwd: string): string {
  const name = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  if (name.length <= 200) return path.join(projectsDir(), name);
  let h = 0;
  for (let i = 0; i < cwd.length; i++) h = ((h << 5) - h + cwd.charCodeAt(i)) | 0;
  return path.join(projectsDir(), `${name.slice(0, 200)}-${Math.abs(h).toString(36)}`);
}

/**
 * A new conversation's transcript, from entries in the CLI's line shape (`toClaudeEntries`; the SDK's SessionStore
 * entries are the same lines). The SDK's own way in — resume from a store — needs the official binary's
 * `--session-mirror`, which the default engine does not have; a `--resume` of this file works on both.
 */
export function writeClaudeTranscript(cwd: string, sessionId: string, entries: object[]): string {
  const dir = claudeProjectDir(cwd);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', { flag: 'wx' });
  return file;
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
export function lastCostState(file: string | null, sessionId: string): { cost: number; models: Record<string, Record<string, number>>; apiMs?: number } | null {
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
  return { cost: found.totalCostUSD, models, ...(typeof found.totalAPIDuration === 'number' ? { apiMs: found.totalAPIDuration } : {}) };
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
 * Where the conversation goes on from (what `repairLeaf` points at): the newest entry of the main chain, unless a
 * `last-prompt` written after all of them points elsewhere (a /rewind in the terminal).
 */
export function currentLeaf(file: string | null): string | null {
  if (!file) return null;
  let leaf: string | undefined;
  let pointed: string | undefined;
  scanBack(file, (line) => {
    if (line.includes('"last-prompt"')) {
      const e = parse(line);
      if (e?.type !== 'last-prompt' || typeof e.leafUuid !== 'string') return false;
      pointed = e.leafUuid;
      return true;
    }
    if (!leaf && line.includes('"uuid"')) {
      const e = parse(line);
      if (e && typeof e.uuid === 'string' && 'parentUuid' in e && e.isSidechain !== true) leaf = e.uuid;
    }
    return false;
  });
  return leaf ?? pointed ?? null;
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

/**
 * A block the Anthropic API refuses anywhere in the history: a text block with nothing to read (and one with
 * cache_control on it), and a thinking block that is only whitespace with no signature — what another vendor's model
 * (deepseek-v4.1-flash, 2026-10-19) wrote now and then. Claude's own blank thinking (display omitted) is signed: kept.
 */
const emptyBlock = (b: any) =>
  (b?.type === 'text' && typeof b.text === 'string' && !b.text.trim())
  || (b?.type === 'thinking' && !String(b.thinking ?? '').trim() && !b.signature);

/**
 * Thinking another vendor's model wrote: no signature. Claude's own thinking is always signed, and the Anthropic API
 * refuses any other in the history — 「Invalid `signature` in `thinking` block」 (DeepSeek's are `signature: ""`).
 */
const unsignedThinking = (b: any) => b?.type === 'thinking' && !b.signature;

const anyThinking = (b: any) => b?.type === 'thinking' || b?.type === 'redacted_thinking';

/** a `"text"` / `"thinking"` field of only whitespace, as JSON writes it (a newline is `\n` in the file) */
const BLANK_FIELD = /"(?:text|thinking)":"(?:\s|\\[nrt])*"/;
const THINKING = /"type":"thinking"/;
const REDACTED = /"type":"redacted_thinking"/;

/**
 * `unsigned`: the history goes to a Claude model — unsigned thinking goes too.
 * `foreign(ts)`: a signature is only good where it was issued — a relay's 「claude-opus-5.5」 signs its thinking its own
 * way, and the account's API refuses those (2026-10-30 user report: switched to a relay and back, then every turn
 * 「Invalid `signature` in `thinking` block」, and 重试 did nothing — they were signed, so `unsigned` kept them). Every
 * thinking block of an assistant message written at `ts` goes when this says another provider wrote it.
 * `allThinking`: the API refused a signature and we cannot tell whose: every thinking block goes (the retry then works).
 */
export interface DropOpts { unsigned?: boolean; foreign?: (ts: number) => boolean; allThinking?: boolean }

/**
 * Takes empty blocks out of a transcript's messages, for good: the engine sends its history again each time, so one
 * of them made every later turn a 400. 2026-10-17: a message that was only a picture went out as [image, text ""] —
 * 「cache_control cannot be set for empty text blocks」 / 「text content blocks must be non-empty」. 2026-10-19: a
 * conversation on DeepSeek switched to Claude — 「each thinking block must contain non-whitespace thinking」.
 * A message left with nothing gets a placeholder. Only after that 400 or a model switch (it reads the whole file) and
 * while no process of ours has the file (before the resume); rewritten through a temporary one, not at all when there
 * is nothing to fix or when the file changed while it was read (another program writing to it). Returns how many
 * messages changed.
 * `unsigned`: the history goes to a Claude model — unsigned thinking goes too (the reasoning another vendor's model
 * showed is no longer in the history; Claude never saw it anyway).
 */
export function dropEmptyBlocks(file: string | null, opts: DropOpts = {}): number {
  if (!file) return 0;
  let text: string;
  let before: { size: number; mtimeMs: number };
  try {
    before = statSync(file);
    if (before.size > 512 * 1024 * 1024) return 0;
    text = readFileSync(file, 'utf8');
  } catch { return 0; }
  const signed = !!opts.allThinking || !!opts.foreign;
  const maybe = (s: string) => BLANK_FIELD.test(s) || ((!!opts.unsigned || signed) && (THINKING.test(s) || REDACTED.test(s)));
  let changed = 0;
  const lines = text.split('\n').map((line) => {
    if (!maybe(line)) return line;
    let e: any;
    try { e = JSON.parse(line); } catch { return line; }
    const c = e?.message?.content;
    if ((e?.type !== 'user' && e?.type !== 'assistant') || !Array.isArray(c)) return line;
    // every thinking block of this message: the API said a signature is bad, or another provider signed it
    const allOfIt = e.type === 'assistant' && (!!opts.allThinking || (!!opts.foreign && opts.foreign(Date.parse(e.timestamp))));
    const drop = (b: any) => emptyBlock(b) || (!!opts.unsigned && unsignedThinking(b)) || (allOfIt && anyThinking(b));
    if (!c.some(drop)) return line;
    const kept = c.filter((b: any) => !drop(b));
    e.message.content = kept.length ? kept : [{ type: 'text', text: '…' }];
    changed++;
    return JSON.stringify(e);
  });
  if (!changed) return 0;
  const tmp = `${file}.cw-${process.pid}.tmp`;
  // something else wrote to it since it was read (the same conversation in a terminal): its lines would be lost
  const same = () => { try { const now = statSync(file); return now.size === before.size && now.mtimeMs === before.mtimeMs; } catch { return false; } };
  try {
    if (!same()) return 0;
    writeFileSync(tmp, lines.join('\n'));
    if (!same()) { try { unlinkSync(tmp); } catch { /* left behind */ } return 0; }
    renameSync(tmp, file);
    return changed;
  } catch {
    try { if (existsSync(tmp)) renameSync(tmp, `${tmp}.failed`); } catch { /* left behind */ }
    return 0;
  }
}
