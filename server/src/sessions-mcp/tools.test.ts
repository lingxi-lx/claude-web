import { describe, expect, it } from 'vitest';
import { scopeSessions, sendAllowed } from './tools.js';

describe('跨对话: how many messages one conversation takes', () => {
  it('ten in ten minutes from all the others together, then refused until the oldest is ten minutes old', () => {
    const t0 = Date.UTC(2026, 9, 16, 9);
    for (let i = 0; i < 10; i++) expect(sendAllowed('loop-target', t0 + i * 1000)).toBe(true);
    expect(sendAllowed('loop-target', t0 + 11_000)).toBe(false);
    expect(sendAllowed('another', t0 + 11_000)).toBe(true);
    expect(sendAllowed('loop-target', t0 + 10 * 60_000 + 1)).toBe(true);
  });
});

describe('跨对话: project scope (stage F2)', () => {
  const row = (sessionId: string, cwd: string) => ({ sessionId, cwd, title: sessionId, lastModified: 0 });
  const all = [row('me', '/app'), row('a2', '/app'), row('s1', '/site'), row('loose', '/tmp')];
  const projectOf = (_id: string, cwd?: string) => (cwd === '/app' ? 'w1' : cwd === '/site' ? 'w2' : undefined);
  it('unrestricted: everything; asked for the project: only its conversations', () => {
    expect(scopeSessions(all, 'me', { projectOf, restricted: () => false }).map((s) => s.sessionId)).toEqual(['me', 'a2', 's1', 'loose']);
    expect(scopeSessions(all, 'me', { projectOf, restricted: () => false }, true).map((s) => s.sessionId)).toEqual(['me', 'a2']);
  });
  it('the project limits its conversations: other projects and loose ones are invisible (so cannot be written to)', () => {
    expect(scopeSessions(all, 'me', { projectOf, restricted: (_id, cwd) => cwd === '/app' }).map((s) => s.sessionId)).toEqual(['me', 'a2']);
    // a conversation outside every project, asked for its project, sees only the loose ones
    expect(scopeSessions(all, 'loose', { projectOf }, true).map((s) => s.sessionId)).toEqual(['loose']);
  });
  it('a new conversation not in the list yet is scoped by the folder it runs in (not left unrestricted)', () => {
    const restricted = (_id: string, cwd?: string) => cwd === '/app';
    expect(scopeSessions(all, 'fresh', { projectOf, restricted, cwdOf: (id) => (id === 'fresh' ? '/app' : undefined) }).map((s) => s.sessionId)).toEqual(['me', 'a2']);
  });
});
