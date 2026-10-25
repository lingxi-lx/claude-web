// What the two forges answer → the PR bar's model (spec E2). Pure; the samples under __fixtures__ are trimmed from
// real gitlab.com REST v4 / GitHub GraphQL replies (field names checked against the live APIs, 2026-10-25).
import type { BranchPr, PrChecks } from '../protocol.js';
import { summarizeChecks } from './pr-status.js';

const bare = (h: string) => h.trim().toLowerCase().replace(/:\d+$/, '');

/** Which forge a remote's host is on: gitlab.com, a self-hosted address the user listed, or a name that says gitlab. */
export function forgeOf(host: string, gitlabHosts: readonly string[]): 'github' | 'gitlab' {
  const h = bare(host);
  if (h === 'gitlab.com' || /gitlab/i.test(h)) return 'gitlab';
  return gitlabHosts.some((x) => bare(String(x)) === h) ? 'gitlab' : 'github';
}

/** The repository's own PR among `pullRequests(headRefName:)` (strangers' forks reuse branch names). */
export function pickGithubPr(nodes: any[]): any | undefined {
  return (nodes ?? []).find((x: any) => x && !x.isCrossRepository);
}

export function mapGithubPr(p: any): BranchPr {
  const c = p.commits?.nodes?.[0]?.commit;
  return {
    host: 'github', base: p.baseRefName,
    id: p.id, number: p.number, title: p.title, url: p.url,
    state: p.state === 'MERGED' ? 'merged' : p.state === 'OPEN' ? 'open' : 'closed',
    draft: !!p.isDraft,
    mergeable: p.mergeable === 'MERGEABLE' ? true : p.mergeable === 'CONFLICTING' ? false : undefined,
    autoMerge: !!p.autoMergeRequest,
    review: p.reviewDecision === 'APPROVED' ? 'approved' : p.reviewDecision === 'CHANGES_REQUESTED' ? 'changes' : p.reviewDecision === 'REVIEW_REQUIRED' ? 'required' : undefined,
    sha: c?.oid ?? '',
    checks: summarizeChecks(c?.statusCheckRollup?.contexts?.nodes ?? []),
  };
}

/** This project's own MR for the branch (an MR from a fork has another source project). */
export function pickGitlabMr(list: any[], projectId: number): any | undefined {
  return (list ?? []).find((m: any) => m && m.source_project_id === projectId && m.target_project_id === projectId);
}

/** A pipeline's jobs → checks: the latest try per job name; allowed failures and manual jobs do not block. */
export function summarizeGitlabJobs(jobs: any[]): PrChecks {
  const latest = new Map<string, any>();
  for (const j of jobs ?? []) {
    if (!j) continue;
    const prev = latest.get(j.name);
    if (!prev || Number(j.id) > Number(prev.id)) latest.set(j.name, j);
  }
  const out: PrChecks = { total: 0, passed: 0, failed: 0, pending: 0, failures: [] };
  for (const j of latest.values()) {
    out.total++;
    const s = String(j.status);
    if (s === 'success' || s === 'skipped' || s === 'manual' || (s === 'failed' && j.allow_failure)) out.passed++;
    else if (s === 'failed' || s === 'canceled') { out.failed++; out.failures.push({ name: j.name, url: j.web_url ?? '', runId: j.id }); }
    else out.pending++;
  }
  return out;
}

const NOT_MERGEABLE = new Set(['conflict', 'broken_status', 'need_rebase']);

export function mapGitlabMr(mr: any, jobs: any[]): BranchPr {
  return {
    host: 'gitlab', base: mr.target_branch,
    id: String(mr.iid), number: mr.iid, title: mr.title, url: mr.web_url,
    state: mr.state === 'merged' ? 'merged' : mr.state === 'opened' ? 'open' : 'closed',
    draft: !!(mr.draft || mr.work_in_progress),
    mergeable: mr.has_conflicts || NOT_MERGEABLE.has(mr.detailed_merge_status) ? false : mr.detailed_merge_status === 'mergeable' ? true : undefined,
    autoMerge: !!mr.merge_when_pipeline_succeeds,
    sha: mr.sha ?? '',
    checks: mr.head_pipeline ? summarizeGitlabJobs(jobs) : { total: 0, passed: 0, failed: 0, pending: 0, failures: [] },
  };
}

/** The end of a CI log, without colours or GitLab's collapsible-section markers, short enough to hand to Claude. */
export function traceTail(text: string, maxLines = 150, maxBytes = 12_000): string {
  const clean = String(text ?? '')
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .split('\n')
    .map((l) => l.replace(/^section_(?:start|end):\d+:[^\r\n]*?\r/, '').replace(/^section_(?:start|end):\d+:[^\r\n]*$/, '').replace(/\r$/, ''));
  while (clean.length && clean[clean.length - 1] === '') clean.pop();
  let out = clean.slice(-maxLines).join('\n');
  if (out.length > maxBytes) out = out.slice(out.length - maxBytes);
  return out;
}
