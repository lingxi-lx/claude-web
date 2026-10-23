// Going on with another tool's conversation in Claude (`SourceCaps.continueInClaude`, DeepSeek Harness): a new
// Claude conversation whose transcript replays what was said there, so any provider / model can pick it up. The tool
// itself is never started — it may need its own key or model (dsh: a DeepSeek API key in its credentials service).
import type { CanonicalEvent } from '../session/canonical.js';
import { toClaudeEntries } from '../session/handoff.js';
import { tr } from '../i18n/index.js';

/**
 * A library read (SDK-shaped messages) → the events a Claude transcript replays: everything said, at full length; a
 * tool call as a one-line note (its output is not carried — the files are still there to read); thinking left out.
 */
export function replayEvents(messages: any[]): CanonicalEvent[] {
  const out: CanonicalEvent[] = [];
  const tools = new Map<string, Extract<CanonicalEvent, { kind: 'tool' }>>();
  for (const m of messages) {
    const content = m?.message?.content;
    const blocks: any[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    if (m.type === 'user') {
      const text: string[] = [];
      for (const b of blocks) {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) text.push(b.text);
        else if (b?.type === 'image') text.push(tr('［图片］'));
        else if (b?.type === 'tool_result') {
          const t = tools.get(String(b.tool_use_id ?? ''));
          if (t && b.is_error) t.ok = false;
        }
      }
      if (text.length) out.push({ t: 0, kind: 'user', text: text.join('\n') });
    } else if (m.type === 'assistant') {
      for (const b of blocks) {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push({ t: 0, kind: 'assistant', text: b.text });
        else if (b?.type === 'tool_use') {
          const e: Extract<CanonicalEvent, { kind: 'tool' }> = { t: 0, kind: 'tool', id: String(b.id ?? ''), name: String(b.name ?? ''), input: b.input && typeof b.input === 'object' ? b.input : {} };
          tools.set(e.id, e);
          out.push(e);
        }
      }
    }
  }
  return out;
}

/** The transcript lines of Claude conversation `sessionId` that replay `messages` (after `parentUuid`, if given). */
export function continuationEntries(messages: any[], o: { cwd: string; sessionId: string; parentUuid?: string }): Record<string, unknown>[] {
  return toClaudeEntries(replayEvents(messages), o);
}
