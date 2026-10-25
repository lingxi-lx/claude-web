// GitLab for the PR bar (spec E2): the branch's MR with its pipeline, merge when the pipeline succeeds, job logs,
// discussions and who may push (REST v4; the service carries it over `glab api` or a stored token).
import type { PrCommentRef } from '../protocol.js';
import { gitlabComments, isGitlabWriter, type CommentCandidate, type PermissionCache } from './comments.js';
import type { Forge, ForgeApi, Target } from './forge.js';
import { mapGitlabMr, pickGitlabMr, traceTail } from './forge-map.js';

const pid = (t: Target) => encodeURIComponent(`${t.owner}/${t.repo}`);
const enc = encodeURIComponent;

export class GitlabForge implements Forge {
  readonly kind = 'gitlab' as const;
  constructor(private api: ForgeApi, private perms: PermissionCache) {}

  async prForBranch(t: Target, branch: string) {
    const proj = await this.api.rest<any>(t, `/projects/${pid(t)}`);
    if (branch === proj?.default_branch) return { why: 'default-branch' };
    const list = await this.api.rest<any[]>(t, `/projects/${pid(t)}/merge_requests?source_branch=${enc(branch)}&state=all&order_by=updated_at&per_page=10`);
    const hit = pickGitlabMr(list, proj?.id);
    if (!hit) return { why: 'no-pr' };
    const mr = await this.api.rest<any>(t, `/projects/${pid(t)}/merge_requests/${hit.iid}`);
    const jobs = mr?.head_pipeline?.id ? await this.api.rest<any[]>(t, `/projects/${pid(t)}/pipelines/${mr.head_pipeline.id}/jobs?per_page=100&include_retried=true`).catch(() => []) : [];
    return { pr: mapGitlabMr(mr, jobs) };
  }

  async setAutoMerge(t: Target, prId: string, on: boolean) {
    const iid = enc(prId);
    if (on) await this.api.rest(t, `/projects/${pid(t)}/merge_requests/${iid}/merge`, { method: 'PUT', body: { merge_when_pipeline_succeeds: true, auto_merge: true } });
    else await this.api.rest(t, `/projects/${pid(t)}/merge_requests/${iid}/cancel_merge_when_pipeline_succeeds`, { method: 'POST' });
  }

  async failureLog(t: Target, jobId: number): Promise<string> {
    return traceTail(await this.api.rest<string>(t, `/projects/${pid(t)}/jobs/${Number(jobId)}/trace`, { text: true }));
  }

  async comments(t: Target, number: number): Promise<CommentCandidate[]> {
    const ds = await this.api.rest<any[]>(t, `/projects/${pid(t)}/merge_requests/${Number(number)}/discussions?per_page=100`);
    return gitlabComments(ds, `https://${t.host}/${t.owner}/${t.repo}/-/merge_requests/${Number(number)}`);
  }

  async authorTrusted(t: Target, userId: string): Promise<boolean> {
    const key = `${t.host}/${t.owner}/${t.repo}:${userId}`;
    const hit = this.perms.get(key);
    if (hit !== undefined) return hit;
    let ok = false;
    if (/^\d+$/.test(userId)) {
      try { ok = isGitlabWriter((await this.api.rest<any>(t, `/projects/${pid(t)}/members/all/${userId}`))?.access_level); } catch { ok = false; /* 404: not a member */ }
    }
    this.perms.set(key, ok);
    return ok;
  }

  async reply(t: Target, number: number, c: PrCommentRef, body: string) {
    if (!c.replyTo) throw new Error('no discussion to reply to');
    await this.api.rest(t, `/projects/${pid(t)}/merge_requests/${Number(number)}/discussions/${enc(c.replyTo)}/notes`, { method: 'POST', body: { body } });
  }

  async resolve(t: Target, number: number, c: PrCommentRef) {
    if (c.kind !== 'thread' || !c.threadId) return;
    await this.api.rest(t, `/projects/${pid(t)}/merge_requests/${Number(number)}/discussions/${enc(c.threadId)}?resolved=true`, { method: 'PUT' });
  }
}
