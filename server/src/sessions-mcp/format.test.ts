import { describe, expect, it } from 'vitest';
import { fromMarker, lastTurns, listRows } from './format.js';

const s = (id: string, t: number, o: Record<string, unknown> = {}) => ({ sessionId: id, title: `T ${id}`, cwd: '/p', lastModified: t, ...o }) as any;

describe('跨对话工具: formatting', () => {
  it('list: newest first, not itself, not other machines, archived only when asked', () => {
    const all = [s('a', 1), s('self', 9), s('b', 5, { gitBranch: 'feat' }), s('c', 3, { archived: true }), s('peer_x~1', 8, { peer: { id: 'x' } })];
    const stateOf = (id: string) => (id === 'b' ? 'running' : undefined) as any;
    const rows = listRows(all, 'self', stateOf).split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('id: b');
    expect(rows[0]).toContain('branch: feat');
    expect(rows[0]).toContain('status: working');
    expect(rows[1]).toContain('id: a');
    expect(listRows(all, 'self', stateOf, { includeArchived: true })).toContain('id: c');
    expect(listRows([s('self', 1)], 'self', stateOf)).toBe('No other conversations.');
  });
  it('read: the last turns — what was asked and the answer it ended with, no tools', () => {
    const msgs = [
      { type: 'user', message: { content: 'first ask' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'thinking out loud' }, { type: 'tool_use', name: 'Bash' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'first answer' }] } },
      { type: 'user', isMeta: true, message: { content: 'meta' } },
      { type: 'user', message: { content: [{ type: 'text', text: 'second ask' }] } },
    ];
    const out = lastTurns(msgs, 3);
    expect(out).toContain('## Turn 1\n\n**User:** first ask\n\n**Claude:** first answer');
    expect(out).toContain('## Turn 2\n\n**User:** second ask\n\n**Claude:** (no answer yet)');
    expect(out).not.toContain('meta');
    expect(lastTurns(msgs, 1)).not.toContain('first ask');
    expect(lastTurns([], 3)).toBe('Nothing said in this conversation yet.');
  });
  it('the marker escapes what it quotes', () => {
    expect(fromMarker('s1', 'Fix "a" <b>', 'hello')).toBe('<cw-from session="s1" title="Fix &quot;a&quot; &lt;b&gt;">\nhello\n</cw-from>');
  });
});
