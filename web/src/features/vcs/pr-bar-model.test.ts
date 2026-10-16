import { describe, expect, it } from 'vitest';
import type { BranchPr } from '@shared';
import { ciFixMessage, fixKey, newFailures, prSettled } from './pr-bar-model';

const pr = (p: Partial<BranchPr> = {}): BranchPr => ({
  id: 'PR_1', number: 7, title: 't', url: 'u', state: 'open', draft: false, autoMerge: false, sha: 'abc',
  checks: { total: 3, passed: 1, failed: 2, pending: 0, failures: [{ name: 'lint', url: 'https://x/lint', runId: 42 }, { name: 'ci/legacy', url: 'https://x/legacy' }] },
  ...p,
});

describe('PR bar', () => {
  it('a failure is asked about once per pushed commit', () => {
    const p = pr();
    expect(newFailures(p, []).map((f) => f.name)).toEqual(['lint', 'ci/legacy']);
    expect(newFailures(p, [fixKey(p, p.checks.failures[0])]).map((f) => f.name)).toEqual(['ci/legacy']);
    // a new push: the same check failing again is new
    expect(newFailures(pr({ sha: 'def' }), [fixKey(p, p.checks.failures[0])]).map((f) => f.name)).toEqual(['lint', 'ci/legacy']);
  });
  it('nothing to fix on a merged or closed PR', () => {
    expect(newFailures(pr({ state: 'merged' }), [])).toEqual([]);
  });
  it('the message says where to look', () => {
    const p = pr();
    expect(ciFixMessage(p, p.checks.failures)).toBe('PR #7 的 CI 检查失败了：\n- lint（gh run view 42 --log-failed）\n- ci/legacy https://x/legacy\n\n看一下失败原因，修好后提交并推送到这个分支。');
  });
  it('settled = merged or closed', () => {
    expect(prSettled(pr({ state: 'merged' }))).toBe(true);
    expect(prSettled(pr({ state: 'closed' }))).toBe(true);
    expect(prSettled(pr())).toBe(false);
    expect(prSettled(null)).toBe(false);
  });
});
