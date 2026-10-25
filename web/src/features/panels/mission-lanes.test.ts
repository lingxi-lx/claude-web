import { describe, expect, it } from 'vitest';
import type { BranchPr } from '@shared';
import { laneOf, quickAnswer, resolved } from './mission-lanes';

const pr = (p: Partial<BranchPr> = {}): BranchPr => ({ id: 'x', number: 1, title: 't', url: 'u', state: 'open', draft: false, autoMerge: false, sha: 's', checks: { total: 0, passed: 0, failed: 0, pending: 0, failures: [] }, ...p });

describe('总览 lanes', () => {
  it('what waits for you beats everything; then an error; then working', () => {
    expect(laneOf({ state: 'running', pending: 1, pr: pr() })).toBe('attention');
    expect(laneOf({ state: 'waiting', pending: 0 })).toBe('attention');
    expect(laneOf({ state: 'error', pending: 0, pr: pr() })).toBe('error');
    expect(laneOf({ state: 'running', pending: 0, pr: pr() })).toBe('running');
  });
  it('an idle conversation with an open PR: 待审, or 落地中 once approved or set to merge itself', () => {
    expect(laneOf({ state: 'idle', pending: 0, pr: pr() })).toBe('review');
    expect(laneOf({ state: 'idle', pending: 0, pr: pr({ review: 'changes' }) })).toBe('review');
    expect(laneOf({ state: 'idle', pending: 0, pr: pr({ review: 'approved' }) })).toBe('landing');
    expect(laneOf({ state: 'history', pending: 0, pr: pr({ autoMerge: true }) })).toBe('landing');
  });
  it('a draft, a merged or closed PR, or none: idle', () => {
    expect(laneOf({ state: 'idle', pending: 0, pr: pr({ draft: true }) })).toBe('idle');
    expect(laneOf({ state: 'idle', pending: 0, pr: pr({ state: 'merged' }) })).toBe('idle');
    expect(laneOf({ state: 'idle', pending: 0, pr: null })).toBe('idle');
  });
  it('已解决: archived and active in the last week, newest first', () => {
    const now = Date.UTC(2026, 9, 16);
    const day = 24 * 3600_000;
    const all = [{ sessionId: 'a', lastModified: now - day }, { sessionId: 'b', lastModified: now - 9 * day }, { sessionId: 'c', lastModified: now - 2 * 3600_000 }, { sessionId: 'd', lastModified: now }];
    expect(resolved(all, (id) => id !== 'd', now).map((s) => s.sessionId)).toEqual(['c', 'a']);
  });
});

// stage B fix wave (S2): a request that can only be judged by reading it (which site, which script; which apps)
// gets no one-click 允许 on the overview card — the card opens the conversation
describe('总览 quick answers', () => {
  it('only plain tool permissions can be allowed from the card', () => {
    expect(quickAnswer('Bash')).toBe(true);
    expect(quickAnswer('Edit')).toBe(true);
    expect(quickAnswer('browser.site')).toBe(false);
    expect(quickAnswer('mcp__computer__request_access')).toBe(false);
    expect(quickAnswer('AskUserQuestion')).toBe(false);
    expect(quickAnswer('ExitPlanMode')).toBe(false);
  });
});
