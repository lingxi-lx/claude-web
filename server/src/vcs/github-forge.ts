// GitHub for the PR bar (spec E2): the branch's PR with checks, auto-merge, review comments and who may push.
import type { PrCommentRef } from '../protocol.js';
import { tr } from '../i18n/index.js';
import { githubComments, isWriteRole, type CommentCandidate, type PermissionCache } from './comments.js';
import type { Forge, ForgeApi, Target } from './forge.js';
import { mapGithubPr, pickGithubPr } from './forge-map.js';

// `headRefName` alone also matches strangers' forks (hundreds of fork PRs from their `main` on a busy repo): only
// this repository's own branches count, and never the default branch — nobody's conversation "is" that PR
const PR_QUERY = `query($owner:String!,$name:String!,$head:String!){ repository(owner:$owner,name:$name){ defaultBranchRef{ name } pullRequests(headRefName:$head,first:10,orderBy:{field:UPDATED_AT,direction:DESC}){ nodes{ id number title url state isDraft isCrossRepository mergeable reviewDecision baseRefName autoMergeRequest{ enabledAt } commits(last:1){ nodes{ commit{ oid statusCheckRollup{ contexts(first:100){ nodes{ __typename ... on CheckRun{ name status conclusion detailsUrl checkSuite{ workflowRun{ databaseId } } } ... on StatusContext{ context state targetUrl } } } } } } } } } } }`;

const COMMENTS_QUERY = `query($owner:String!,$name:String!,$n:Int!){ viewer{ login } repository(owner:$owner,name:$name){ pullRequest(number:$n){ reviewThreads(last:100){ nodes{ id isResolved path line originalLine comments(last:20){ nodes{ databaseId author{ login __typename } body url createdAt diffHunk } } } } comments(last:50){ nodes{ databaseId author{ login __typename } body url createdAt } } } } }`;

export class GithubForge implements Forge {
  readonly kind = 'github' as const;
  constructor(private api: ForgeApi, private perms: PermissionCache) {}

  async prForBranch(t: Target, branch: string) {
    const d = await this.api.graphql<any>(t, PR_QUERY, { owner: t.owner, name: t.repo, head: branch });
    if (branch === d.repository?.defaultBranchRef?.name) return { why: 'default-branch' };
    const p = pickGithubPr(d.repository?.pullRequests?.nodes ?? []);
    if (!p) return { why: 'no-pr' };
    return { pr: mapGithubPr(p) };
  }

  async setAutoMerge(t: Target, prId: string, on: boolean) {
    if (on) await this.api.graphql(t, 'mutation($id:ID!){ enablePullRequestAutoMerge(input:{ pullRequestId:$id, mergeMethod:SQUASH }){ clientMutationId } }', { id: prId });
    else await this.api.graphql(t, 'mutation($id:ID!){ disablePullRequestAutoMerge(input:{ pullRequestId:$id }){ clientMutationId } }', { id: prId });
  }

  async failureLog(): Promise<string> {
    throw new Error(tr('GitHub 的失败日志用 gh run view 读'));
  }

  async comments(t: Target, number: number): Promise<CommentCandidate[]> {
    return githubComments(await this.api.graphql<any>(t, COMMENTS_QUERY, { owner: t.owner, name: t.repo, n: number }));
  }

  async authorTrusted(t: Target, login: string): Promise<boolean> {
    const key = `${t.host}/${t.owner}/${t.repo}:${login}`;
    const hit = this.perms.get(key);
    if (hit !== undefined) return hit;
    let ok = false;
    try { ok = isWriteRole(await this.api.rest<any>(t, `/repos/${t.owner}/${t.repo}/collaborators/${encodeURIComponent(login)}/permission`)); } catch { ok = false; /* 403 / 404: not a collaborator, or we may not ask */ }
    this.perms.set(key, ok);
    return ok;
  }

  async reply(t: Target, number: number, c: PrCommentRef, body: string) {
    if (c.kind === 'thread' && c.replyTo) await this.api.rest(t, `/repos/${t.owner}/${t.repo}/pulls/${number}/comments/${encodeURIComponent(c.replyTo)}/replies`, { method: 'POST', body: { body } });
    else await this.api.rest(t, `/repos/${t.owner}/${t.repo}/issues/${number}/comments`, { method: 'POST', body: { body } });
  }

  async resolve(t: Target, _number: number, c: PrCommentRef) {
    if (c.kind !== 'thread' || !c.threadId) return;
    await this.api.graphql(t, 'mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ id } } }', { id: c.threadId });
  }
}
