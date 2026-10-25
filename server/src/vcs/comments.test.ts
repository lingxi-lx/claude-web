import { describe, expect, it } from 'vitest';
import { githubComments, gitlabComments, hunkAround, isGitlabWriter, isWriteRole, PermissionCache, REPLY_MARK } from './comments';

describe('isWriteRole / isGitlabWriter', () => {
  it('write, maintain and admin count; triage, read, none and junk do not', () => {
    expect(isWriteRole({ permission: 'write', role_name: 'write' })).toBe(true);
    expect(isWriteRole({ permission: 'write', role_name: 'maintain' })).toBe(true);
    expect(isWriteRole({ permission: 'admin' })).toBe(true);
    expect(isWriteRole({ permission: 'read', role_name: 'triage' })).toBe(false);
    expect(isWriteRole({ permission: 'none' })).toBe(false);
    expect(isWriteRole(null)).toBe(false);
  });
  it('GitLab: Developer (30) and up', () => {
    expect(isGitlabWriter(30)).toBe(true);
    expect(isGitlabWriter(50)).toBe(true);
    expect(isGitlabWriter(20)).toBe(false);
    expect(isGitlabWriter(undefined)).toBe(false);
  });
});

describe('PermissionCache', () => {
  it('answers for 10 minutes, then forgets', () => {
    let now = 1_000;
    const c = new PermissionCache(600_000, () => now);
    c.set('github.com/acme/app:alice', true);
    expect(c.get('github.com/acme/app:alice')).toBe(true);
    now += 599_999;
    expect(c.get('github.com/acme/app:alice')).toBe(true);
    now += 2;
    expect(c.get('github.com/acme/app:alice')).toBeUndefined();
  });
});

const gh = { viewer: { login: 'me' }, repository: { pullRequest: {
  reviewThreads: { nodes: [
    { id: 'T1', isResolved: false, path: 'src/a.ts', line: 12, originalLine: 10, comments: { nodes: [
      { databaseId: 101, author: { login: 'alice', __typename: 'User' }, body: '这里要判空', url: 'u101', createdAt: '2026-10-20T01:00:00Z', diffHunk: '@@ -8,4 +8,6 @@\n a\n+b' }] } },
    { id: 'T2', isResolved: true, path: 'src/b.ts', line: 3, comments: { nodes: [
      { databaseId: 102, author: { login: 'alice', __typename: 'User' }, body: 'done', url: 'u102', createdAt: '2026-10-20T01:00:00Z' }] } },
    { id: 'T3', isResolved: false, path: 'src/c.ts', line: null, originalLine: 7, comments: { nodes: [
      { databaseId: 103, author: { login: 'bob', __typename: 'User' }, body: '改名', url: 'u103', createdAt: '2026-10-20T02:00:00Z' },
      { databaseId: 104, author: { login: 'me', __typename: 'User' }, body: `已在 abc1234 修改\n\n${REPLY_MARK}`, url: 'u104', createdAt: '2026-10-20T03:00:00Z' }] } },
  ] },
  comments: { nodes: [
    { databaseId: 201, author: { login: 'dependabot', __typename: 'Bot' }, body: 'bump', url: 'u201', createdAt: '2026-10-21T00:00:00Z' },
    { databaseId: 202, author: null, body: 'ghost', url: 'u202', createdAt: '2026-10-21T00:00:00Z' },
    { databaseId: 203, author: { login: 'me', __typename: 'User' }, body: `> x\n\n已在 abc1234 修改\n\n${REPLY_MARK}`, url: 'u203', createdAt: '2026-10-21T01:00:00Z' },
  ] },
} } };

describe('githubComments', () => {
  it('unresolved threads by their last comment; resolved and already-answered threads dropped; our replies never come back', () => {
    const out = githubComments(gh);
    expect(out.map((c) => c.id)).toEqual(['gh:rc:101', 'gh:ic:201', 'gh:ic:202']);
    expect(out[0]).toMatchObject({ kind: 'thread', threadId: 'T1', replyTo: '101', author: 'alice', authorKey: 'alice', bot: false, path: 'src/a.ts', line: 12, diff: '@@ -8,4 +8,6 @@\n a\n+b', url: 'u101' });
    expect(out[1]).toMatchObject({ kind: 'general', author: 'dependabot', bot: true });
    expect(out[2]).toMatchObject({ author: 'ghost', bot: true }); // a deleted account is never trusted
  });
  it('a thread without a current line falls back to originalLine', () => {
    const d = structuredClone(gh);
    d.repository.pullRequest.reviewThreads.nodes[2].comments.nodes.pop();
    expect(githubComments(d).find((c) => c.id === 'gh:rc:103')).toMatchObject({ line: 7, path: 'src/c.ts' });
  });
});

const gl = [
  { id: 'd1', individual_note: false, notes: [{ id: 301, system: false, resolvable: true, resolved: false, author: { id: 7, username: 'carol' }, body: '少了测试', created_at: '2026-10-22T00:00:00Z', position: { new_path: 'lib/x.rb', new_line: 40 } }] },
  { id: 'd2', individual_note: true, notes: [{ id: 302, system: false, resolvable: false, resolved: false, author: { id: 8, username: 'project_12_bot3' }, body: 'pipeline note', created_at: '2026-10-22T01:00:00Z' }] },
  { id: 'd3', individual_note: true, notes: [{ id: 303, system: true, author: { id: 7, username: 'carol' }, body: 'added 1 commit', created_at: '2026-10-22T02:00:00Z' }] },
  { id: 'd4', individual_note: false, notes: [{ id: 304, system: false, resolvable: true, resolved: true, author: { id: 7, username: 'carol' }, body: 'ok', created_at: '2026-10-22T03:00:00Z' }] },
  { id: 'd5', individual_note: false, notes: [
    { id: 305, system: false, resolvable: true, resolved: false, author: { id: 9, username: 'dave' }, body: '再看看', created_at: '2026-10-22T04:00:00Z' },
    { id: 306, system: false, resolvable: true, resolved: false, author: { id: 1, username: 'me' }, body: `已在 abc1234 修改\n\n${REPLY_MARK}`, created_at: '2026-10-22T05:00:00Z' }] },
];

describe('gitlabComments', () => {
  it('unresolved discussions and individual notes; system notes, resolved and answered discussions dropped', () => {
    const out = gitlabComments(gl, 'https://gitlab.com/acme/app/-/merge_requests/5');
    expect(out.map((c) => c.id)).toEqual(['gl:n:301', 'gl:n:302']);
    expect(out[0]).toMatchObject({ kind: 'thread', threadId: 'd1', replyTo: 'd1', author: 'carol', authorKey: '7', bot: false, path: 'lib/x.rb', line: 40, url: 'https://gitlab.com/acme/app/-/merge_requests/5#note_301' });
    expect(out[1]).toMatchObject({ kind: 'general', bot: true, replyTo: 'd2', authorKey: '8' });
  });
});

describe('hunkAround', () => {
  const diff = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,3 +1,4 @@', ' one', '+two', ' three', ' four', '@@ -40,3 +41,4 @@', ' x', '+y', ' z', ' w'].join('\n');
  it('the hunk whose new side holds the line', () => {
    expect(hunkAround(diff, 2)).toBe(['@@ -1,3 +1,4 @@', ' one', '+two', ' three', ' four'].join('\n'));
    expect(hunkAround(diff, 42)).toBe(['@@ -40,3 +41,4 @@', ' x', '+y', ' z', ' w'].join('\n'));
    expect(hunkAround(diff, 20)).toBeUndefined();
    expect(hunkAround('', 1)).toBeUndefined();
  });
  it('a long hunk is cut to the lines around it', () => {
    const body = Array.from({ length: 100 }, (_, i) => ` l${i + 1}`);
    const out = hunkAround(['@@ -1,100 +1,100 @@', ...body].join('\n'), 50, 3)!;
    expect(out.split('\n')).toEqual(['@@ -1,100 +1,100 @@', ' l47', ' l48', ' l49', ' l50', ' l51', ' l52', ' l53']);
  });
});
