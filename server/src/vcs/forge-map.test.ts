import { describe, expect, it } from 'vitest';
import mr from './__fixtures__/gitlab-mr.json';
import mrList from './__fixtures__/gitlab-mr-list.json';
import jobs from './__fixtures__/gitlab-jobs.json';
import ghNodes from './__fixtures__/github-pr-nodes.json';
import { envTokenFor, forgeOf, mapGithubPr, mapGitlabMr, pickGithubPr, pickGitlabMr, summarizeGitlabJobs, traceTail } from './forge-map';

describe('forgeOf', () => {
  it('gitlab.com, a listed self-hosted address (any case, port ignored), or a name that says gitlab', () => {
    expect(forgeOf('gitlab.com', [])).toBe('gitlab');
    expect(forgeOf('git.corp.example:8443', ['GIT.corp.example'])).toBe('gitlab');
    expect(forgeOf('gitlab.internal', [])).toBe('gitlab');
    expect(forgeOf('github.com', ['git.corp.example'])).toBe('github');
    expect(forgeOf('ghe.corp', [])).toBe('github');
  });
});

describe('envTokenFor', () => {
  const env = { GH_TOKEN: 'gh', GITHUB_TOKEN: 'ghx', GITLAB_TOKEN: 'gl', GH_ENTERPRISE_TOKEN: 'ghe' };
  it('GH_TOKEN / GITHUB_TOKEN only for github.com; never for another host that is on GitHub', () => {
    expect(envTokenFor('github', 'github.com', env)).toBe('gh');
    expect(envTokenFor('github', 'GitHub.com:443', { GITHUB_TOKEN: 'ghx' })).toBe('ghx');
    expect(envTokenFor('github', 'evil.example', env)).toBe('');
    expect(envTokenFor('github', 'ghe.corp', { GH_TOKEN: 'gh' })).toBe('');
  });
  it('GH_ENTERPRISE_TOKEN only for GH_HOST', () => {
    expect(envTokenFor('github', 'ghe.corp', { ...env, GH_HOST: 'https://ghe.corp/' })).toBe('ghe');
    expect(envTokenFor('github', 'other.corp', { ...env, GH_HOST: 'ghe.corp' })).toBe('');
  });
  it('GITLAB_TOKEN only for gitlab.com or GITLAB_HOST — not any host whose name says gitlab', () => {
    expect(envTokenFor('gitlab', 'gitlab.com', env)).toBe('gl');
    expect(envTokenFor('gitlab', 'gitlab.evil.example', env)).toBe('');
    expect(envTokenFor('gitlab', 'mygitlab.io', env)).toBe('');
    expect(envTokenFor('gitlab', 'git.corp', { ...env, GITLAB_HOST: 'https://git.corp' })).toBe('gl');
    expect(envTokenFor('gitlab', 'gitlab.com', { ...env, GITLAB_HOST: 'git.corp' })).toBe('gl');
  });
});

describe('GitHub → bar', () => {
  it('skips a fork PR, maps the own one', () => {
    const p = pickGithubPr(ghNodes);
    expect(p.number).toBe(12);
    expect(mapGithubPr(p)).toEqual({
      host: 'github', base: 'main', id: 'PR_kwDO1', number: 12, title: 'Retry uploads', url: 'https://github.com/acme/app/pull/12', state: 'open', draft: false,
      mergeable: false, autoMerge: true, review: 'changes', sha: 'abc123',
      checks: { total: 2, passed: 1, failed: 1, pending: 0, failures: [{ name: 'test', url: 'https://github.com/acme/app/actions/runs/7/job/1', runId: 7 }] },
    });
  });
});

describe('GitLab → bar', () => {
  it('picks the MR from this project, not a fork one', () => {
    expect(pickGitlabMr(mrList, 77)?.iid).toBe(5);
    expect(pickGitlabMr(mrList.slice(0, 1), 77)).toBeUndefined();
  });
  it('the latest job per name; allow_failure and manual do not block; running is pending', () => {
    expect(summarizeGitlabJobs(jobs)).toEqual({ total: 5, passed: 3, failed: 1, pending: 1, failures: [{ name: 'unit', url: 'https://gitlab.com/acme/app/-/jobs/1005', runId: 1005 }] });
  });
  it('maps the MR', () => {
    expect(mapGitlabMr(mr, jobs)).toEqual({
      host: 'gitlab', base: 'main', id: '5', number: 5, title: 'Add retry to the uploader', url: 'https://gitlab.com/acme/app/-/merge_requests/5',
      state: 'open', draft: false, mergeable: undefined, autoMerge: true, sha: '3f2a9c1d0b8e7f6a5c4d3e2f1a0b9c8d7e6f5a4b',
      checks: summarizeGitlabJobs(jobs),
    });
  });
  it('merge status, conflicts, merged / closed / locked, draft', () => {
    expect(mapGitlabMr({ ...mr, detailed_merge_status: 'mergeable' }, []).mergeable).toBe(true);
    expect(mapGitlabMr({ ...mr, has_conflicts: true }, []).mergeable).toBe(false);
    expect(mapGitlabMr({ ...mr, state: 'merged' }, []).state).toBe('merged');
    expect(mapGitlabMr({ ...mr, state: 'locked' }, []).state).toBe('closed');
    expect(mapGitlabMr({ ...mr, draft: true }, []).draft).toBe(true);
    expect(mapGitlabMr({ ...mr, head_pipeline: null }, []).checks.total).toBe(0);
  });
});

describe('traceTail', () => {
  it('drops ANSI colours and GitLab section markers, keeps the last lines', () => {
    const t = ['\u001b[32;1m$ npm test\u001b[0;m', 'section_start:1700000000:step_script\r\u001b[0Kok', ...Array.from({ length: 300 }, (_, i) => `line ${i}`), 'section_end:1700000001:step_script\r\u001b[0K'].join('\n');
    const out = traceTail(t, 150);
    expect(out).not.toMatch(/\u001b|section_(start|end)/);
    expect(out.split('\n')).toHaveLength(150);
    expect(out.endsWith('line 299')).toBe(true);
    expect(traceTail('x'.repeat(50_000), 150, 12_000).length).toBeLessThanOrEqual(12_000);
  });
});
