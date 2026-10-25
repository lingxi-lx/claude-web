import { describe, expect, it } from 'vitest';
import { DISCUSSION_PAGES, GitlabForge } from './gitlab-forge';
import { PermissionCache } from './comments';

const t = { provider: 'gitlab' as const, host: 'gitlab.com', owner: 'g', repo: 'p' };

describe('GitlabForge (E-minor)', () => {
  it('reads discussions page by page until a short page (the newest are on the last page)', async () => {
    const calls: string[] = [];
    const api = { rest: async (_t: any, path: string) => { calls.push(path); const page = Number(/[?&]page=(\d+)/.exec(path)![1]); return Array.from({ length: page < 3 ? 100 : 7 }, () => ({ id: 'd', notes: [] })); }, graphql: async () => ({}) };
    await new GitlabForge(api as any, new PermissionCache()).comments(t, 5);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain('page=3');
  });
  it('stops at the page cap', async () => {
    let n = 0;
    const api = { rest: async () => { n++; return Array.from({ length: 100 }, () => ({ id: 'd', notes: [] })); }, graphql: async () => ({}) };
    await new GitlabForge(api as any, new PermissionCache()).comments(t, 5);
    expect(n).toBe(DISCUSSION_PAGES);
  });
  it('merge when the pipeline succeeds is refused while the head has no pipeline (GitLab would merge at once)', async () => {
    const puts: string[] = [];
    const mk = (pipeline: any) => ({ rest: async (_t: any, path: string, init?: any) => { if (init?.method) { puts.push(path); return {}; } return { iid: 5, head_pipeline: pipeline }; }, graphql: async () => ({}) });
    await expect(new GitlabForge(mk(null) as any, new PermissionCache()).setAutoMerge(t, '5', true)).rejects.toThrow();
    expect(puts).toEqual([]);
    await new GitlabForge(mk({ id: 9 }) as any, new PermissionCache()).setAutoMerge(t, '5', true);
    expect(puts).toEqual(['/projects/g%2Fp/merge_requests/5/merge']);
    // turning it off needs no pipeline
    await new GitlabForge(mk(null) as any, new PermissionCache()).setAutoMerge(t, '5', false);
    expect(puts.at(-1)).toContain('cancel_merge_when_pipeline_succeeds');
  });
});
