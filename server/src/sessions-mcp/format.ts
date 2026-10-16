// 跨对话工具 (spec 2026-10-16 sessions-env §1–2): what Claude reads about other conversations, and the marker a message
// from one conversation carries into another. Pure: the tools (tools.ts) feed these from the library and the pool.
import type { RunnerState, SessionSummary } from '../protocol.js';

export const LIST_LIMIT = 20;
const SNIPPET = 200;
const TURN_TEXT = 4000;

/** One row of list_sessions: enough to choose which conversation to read or write to. */
export function listRows(all: SessionSummary[], selfId: string, stateOf: (id: string) => RunnerState | undefined, o: { includeArchived?: boolean; limit?: number } = {}): string {
  const rows = all
    .filter((s) => s.sessionId !== selfId && !s.peer && (o.includeArchived || !s.archived))
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, Math.max(1, Math.min(o.limit ?? LIST_LIMIT, 50)));
  if (!rows.length) return 'No other conversations.';
  return rows.map((s) => {
    const st = stateOf(s.sessionId);
    const status = st === 'running' || st === 'starting' ? 'working' : st === 'waiting' ? 'waiting for the user' : 'idle';
    const bits = [`id: ${s.sessionId}`, `title: ${s.customTitle || s.title || '(untitled)'}`, `folder: ${s.cwd || '?'}`];
    if (s.gitBranch) bits.push(`branch: ${s.gitBranch}`);
    bits.push(`status: ${status}`, `last active: ${new Date(s.lastModified).toISOString()}`);
    if (s.archived) bits.push('archived');
    return `- ${bits.join(' | ')}`;
  }).join('\n');
}

/** The text of a user / assistant message (text blocks only: no tools, no thinking). */
function textOf(m: any): string {
  const c = m?.message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n');
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** read_session: the last `turns` turns — what was asked and the answer each ended with. */
export function lastTurns(messages: any[], turns = 3): string {
  const out: { ask: string; answer: string }[] = [];
  for (const m of messages) {
    if (m?.type === 'user' && !m.parent_tool_use_id && !m.isMeta) {
      const t = textOf(m).trim();
      if (t) out.push({ ask: t, answer: '' });
    } else if (m?.type === 'assistant' && !m.parent_tool_use_id && out.length) {
      const t = textOf(m).trim();
      if (t) out[out.length - 1].answer = t; // the last text of the turn is its answer
    }
  }
  const n = Math.max(1, Math.min(turns, 10));
  const shown = out.slice(-n);
  if (!shown.length) return 'Nothing said in this conversation yet.';
  return shown.map((t, i) => `## Turn ${out.length - shown.length + i + 1}\n\n**User:** ${cut(t.ask, TURN_TEXT)}\n\n**Claude:** ${t.answer ? cut(t.answer, TURN_TEXT) : '(no answer yet)'}`).join('\n\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The message as the receiving conversation gets it: the web UI draws it as a card from that conversation. */
export function fromMarker(fromId: string, fromTitle: string, message: string): string {
  return `<cw-from session="${esc(fromId)}" title="${esc(fromTitle)}">\n${message}\n</cw-from>`;
}

export const snippet = (s: string) => cut(s.replace(/\s+/g, ' ').trim(), SNIPPET);
