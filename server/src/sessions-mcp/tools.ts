// 跨对话工具 (spec 2026-10-16 sessions-env §1–2; the official app's cross-session messaging): Claude lists the other
// conversations on this computer, reads one, writes to one, renames, archives, and suggests a task for a new one.
// An in-process MCP server (the SDK's createSdkMcpServer): the tools run here, beside the pool and the library — no
// extra process, no secret to hand over. Archiving goes through the conversation's own permission mode (the CLI asks
// unless it is auto / bypass); the rest are allowed without asking, like the official app.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import type { RunnerState, SessionSummary } from '../protocol.js';
import { fromMarker, lastTurns, listRows } from './format.js';

export const SESSIONS_SERVER = 'sessions';
/** Everything but archive_session runs without asking (the official app asks only before archiving). */
export const SESSIONS_ALLOWED = ['list_sessions', 'read_session', 'send_to_session', 'rename_session', 'suggest_task'].map((t) => `mcp__${SESSIONS_SERVER}__${t}`);

export interface SessionsDeps {
  list(): Promise<SessionSummary[]>;
  read(id: string): Promise<any[]>;
  stateOf(id: string): RunnerState | undefined;
  /** queued until the receiver is idle, then sent as a new turn; throws when it cannot be delivered at all */
  deliver(id: string, text: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  archive(id: string): Promise<void>;
  /** a scheduled task's conversation: nobody is watching it, so nothing is delivered there (the official app's rule) */
  isScheduled?(id: string): boolean;
}

let deps: SessionsDeps | null = null;
let enabled = true;
/** Wired at startup (index.ts); null in tests and before the library is up: no server is handed out. */
export function setSessionsDeps(d: SessionsDeps | null) { deps = d; }
/** Settings switch `sessions.mcp`. */
export function setSessionsMcpEnabled(on: boolean) { enabled = on; }
export function sessionsMcpEnabled() { return enabled && !!deps; }

/**
 * At most this many messages to one conversation in the window, from all the others together: two conversations told
 * to keep each other informed would otherwise answer each other for ever, each answer a new turn on both sides.
 */
const SEND_LIMIT = 10;
const SEND_WINDOW_MS = 10 * 60_000;
const sent = new Map<string, number[]>();
/** true and counted when one more may go to `id` now. Exported for tests. */
export function sendAllowed(id: string, now = Date.now()): boolean {
  const recent = (sent.get(id) ?? []).filter((t) => now - t < SEND_WINDOW_MS);
  if (recent.length >= SEND_LIMIT) { sent.set(id, recent); return false; }
  recent.push(now);
  sent.set(id, recent);
  return true;
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });

/** The conversation's own server: `self()` is its id now (a new conversation gets its id from the engine). */
export function sessionsMcpServer(self: () => string, d: SessionsDeps = deps!) {
  const find = async (id: string) => (await d.list()).find((s) => s.sessionId === id);
  const titleOf = (s: SessionSummary | undefined) => s?.customTitle || s?.title || '(untitled)';
  return createSdkMcpServer({
    name: SESSIONS_SERVER,
    version: '1.0.0',
    tools: [
      tool('list_sessions', 'List the other Claude conversations on this computer, most recently active first: id, title, folder, branch, status (working / waiting for the user / idle).', {
        include_archived: z.boolean().optional().describe('also list archived conversations'),
        limit: z.number().int().min(1).max(50).optional().describe('how many (default 20)'),
      }, async (a) => text(listRows(await d.list(), self(), (id) => d.stateOf(id), { includeArchived: a.include_archived, limit: a.limit }))),

      tool('read_session', 'Read what another conversation has been doing: its last turns (the user\'s messages and the answers, without tool details).', {
        id: z.string().describe('conversation id from list_sessions'),
        turns: z.number().int().min(1).max(10).optional().describe('how many recent turns (default 3)'),
      }, async (a) => {
        if (a.id === self()) return fail('That is this conversation.');
        if (!(await find(a.id))) return fail(`No conversation ${a.id}. Use list_sessions.`);
        return text(lastTurns(await d.read(a.id), a.turns ?? 3));
      }),

      tool('send_to_session', 'Send a message to another conversation. If it is working, the message waits until its current turn ends, then starts a new turn there. It shows as coming from this conversation. Not for archived conversations.', {
        id: z.string().describe('conversation id from list_sessions'),
        message: z.string().min(1).max(20_000),
      }, async (a) => {
        if (a.id === self()) return fail('That is this conversation.');
        const to = await find(a.id);
        if (!to) return fail(`No conversation ${a.id}. Use list_sessions.`);
        if (to.archived) return fail('That conversation is archived: messages are not delivered to archived conversations.');
        if (to.peer) return fail('That conversation is on another computer.');
        if (d.isScheduled?.(a.id)) return fail('That is a scheduled task\'s conversation: nobody is watching it, so messages are not delivered there.');
        if (!sendAllowed(a.id)) return fail(`Too many messages to "${titleOf(to)}" in the last ${SEND_WINDOW_MS / 60_000} minutes (${SEND_LIMIT}). If the two conversations are answering each other, stop and tell the user.`);
        const me = await find(self());
        await d.deliver(a.id, fromMarker(self(), titleOf(me), a.message));
        const st = d.stateOf(a.id);
        return text(st === 'running' || st === 'starting' || st === 'waiting' ? `Queued for "${titleOf(to)}": it is busy, the message goes in when its turn ends.` : `Sent to "${titleOf(to)}".`);
      }),

      tool('rename_session', 'Rename a conversation (this one or another).', {
        id: z.string().optional().describe('conversation id; omitted = this conversation'),
        title: z.string().min(1).max(200),
      }, async (a) => {
        const id = a.id || self();
        if (!(await find(id))) return fail(`No conversation ${id}.`);
        await d.rename(id, a.title.trim());
        return text(`Renamed to "${a.title.trim()}".`);
      }),

      tool('archive_session', 'Archive a conversation (it leaves the sidebar; the user can bring it back). Asks the user first unless the permission mode allows it.', {
        id: z.string().describe('conversation id from list_sessions'),
      }, async (a) => {
        if (a.id === self()) return fail('A conversation cannot archive itself.');
        const to = await find(a.id);
        if (!to) return fail(`No conversation ${a.id}.`);
        const st = d.stateOf(a.id);
        if (st === 'running' || st === 'starting' || st === 'waiting') return fail('That conversation is working; archive it when it is idle.');
        await d.archive(a.id);
        return text(`Archived "${titleOf(to)}".`);
      }),

      tool('suggest_task', 'Suggest a piece of work outside the current task that is worth doing separately. The user sees it as a chip in this conversation and can start it in a new conversation (its own git worktree by default) with one click. Returns at once; do not wait for it.', {
        title: z.string().min(1).max(120).describe('short name of the task'),
        prompt: z.string().min(1).max(8000).describe('the full instructions the new conversation starts with'),
        worktree: z.boolean().optional().describe('start it in its own git worktree (default true)'),
      }, async () => text('Shown to the user as a task chip. Carry on with the current task.')),
    ],
  });
}
