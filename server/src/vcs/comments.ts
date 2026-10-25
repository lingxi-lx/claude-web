import type { PrComment } from '../protocol.js';

/**
 * PR / MR review comments (spec E1). Everything here is pure: the forges fetch, these functions decide which comments
 * are still open and who wrote them. Comment text is untrusted — only `trusted` (write-permission) authors are ever
 * handed to Claude automatically, and the web side frames the text as data.
 */

/** Our own replies carry this, so the next poll never treats them (or the thread they closed) as new work. */
export const REPLY_MARK = '<!-- claude-web:reply -->';

/** GitHub collaborator permission → may push. `permission` reports maintain as write, `role_name` has the real role. */
export function isWriteRole(r: { permission?: string; role_name?: string } | null | undefined): boolean {
  if (!r) return false;
  return ['admin', 'maintain', 'write'].includes(String(r.role_name ?? '')) || ['admin', 'write'].includes(String(r.permission ?? ''));
}

/** GitLab access level: Developer (30) and up may push. */
export function isGitlabWriter(accessLevel: number | undefined): boolean {
  return typeof accessLevel === 'number' && accessLevel >= 30;
}

/** author → may-push, for 10 minutes (one REST call per author per repo, not per poll). */
export class PermissionCache {
  private m = new Map<string, { v: boolean; at: number }>();
  constructor(private ttlMs = 600_000, private now: () => number = Date.now) {}
  get(key: string): boolean | undefined {
    const hit = this.m.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at >= this.ttlMs) { this.m.delete(key); return undefined; }
    return hit.v;
  }
  set(key: string, v: boolean): void { this.m.set(key, { v, at: this.now() }); }
}

export type CommentCandidate = Omit<PrComment, 'trusted'> & { authorKey: string };

function ghAuthor(a: any): { author: string; bot: boolean } {
  const login = typeof a?.login === 'string' ? a.login : 'ghost';
  return { author: login, bot: !a || a.__typename === 'Bot' || /\[bot\]$/i.test(login) };
}

/** The `data` of the comments GraphQL query → open review threads (by their last comment), then plain comments. */
export function githubComments(data: any): CommentCandidate[] {
  const pr = data?.repository?.pullRequest;
  if (!pr) return [];
  const out: CommentCandidate[] = [];
  for (const t of pr.reviewThreads?.nodes ?? []) {
    if (!t || t.isResolved) continue;
    const nodes = t.comments?.nodes ?? [];
    const c = nodes[nodes.length - 1];
    if (!c || String(c.body ?? '').includes(REPLY_MARK)) continue;
    const { author, bot } = ghAuthor(c.author);
    out.push({ id: `gh:rc:${c.databaseId}`, kind: 'thread', threadId: t.id, replyTo: String(c.databaseId), author, authorKey: author, bot, body: String(c.body ?? ''), path: t.path ?? undefined, line: t.line ?? t.originalLine ?? undefined, diff: c.diffHunk || undefined, url: String(c.url ?? ''), createdAt: String(c.createdAt ?? '') });
  }
  for (const c of pr.comments?.nodes ?? []) {
    if (!c || String(c.body ?? '').includes(REPLY_MARK)) continue;
    const { author, bot } = ghAuthor(c.author);
    out.push({ id: `gh:ic:${c.databaseId}`, kind: 'general', author, authorKey: author, bot, body: String(c.body ?? ''), url: String(c.url ?? ''), createdAt: String(c.createdAt ?? '') });
  }
  return out;
}

const GL_BOT = /(^project_\d+_bot\d*$)|(^group_\d+_bot\d*$)|bot$/i;

/** MR discussions → open ones by their last note. */
export function gitlabComments(discussions: any[], mrUrl: string): CommentCandidate[] {
  const out: CommentCandidate[] = [];
  for (const d of discussions ?? []) {
    const notes = (d?.notes ?? []).filter((n: any) => n && !n.system);
    if (!notes.length) continue;
    if (!d.individual_note && notes.some((n: any) => n.resolvable && n.resolved)) continue;
    const n = notes[notes.length - 1];
    if (String(n.body ?? '').includes(REPLY_MARK)) continue;
    const username = String(n.author?.username ?? 'ghost');
    out.push({
      id: `gl:n:${n.id}`, kind: d.individual_note ? 'general' : 'thread', threadId: d.individual_note ? undefined : String(d.id), replyTo: String(d.id),
      author: username, authorKey: String(n.author?.id ?? ''), bot: !n.author || GL_BOT.test(username) || n.author?.bot === true,
      body: String(n.body ?? ''), path: n.position?.new_path ?? undefined, line: n.position?.new_line ?? n.position?.old_line ?? undefined,
      url: `${mrUrl}#note_${n.id}`, createdAt: String(n.created_at ?? ''),
    });
  }
  return out;
}

/** The hunk of a unified diff whose new side holds `line`, cut to `context` lines around it when long. */
export function hunkAround(diff: string, line: number, context = 6): string | undefined {
  if (!diff) return undefined;
  const lines = diff.split('\n');
  const head = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
  for (let i = 0; i < lines.length; i++) {
    const m = head.exec(lines[i]);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    let j = i + 1;
    while (j < lines.length && !head.test(lines[j]) && !lines[j].startsWith('diff --git')) j++;
    if (!(start <= line && line < start + count)) { i = j - 1; continue; }
    const body = lines.slice(i + 1, j);
    if (body.length + 1 <= context * 2 + 2) return [lines[i], ...body].join('\n');
    let n = start;
    let at = -1;
    for (let k = 0; k < body.length; k++) {
      if (body[k].startsWith('-')) continue;
      if (n === line) { at = k; break; }
      n++;
    }
    if (at < 0) return [lines[i], ...body].join('\n');
    return [lines[i], ...body.slice(Math.max(0, at - context), at + context + 1)].join('\n');
  }
  return undefined;
}
