// A fake GitHub (Enterprise layout: /api/v3, /api/graphql) and GitLab (/api/v4) on one 127.0.0.1 port, for e2e
// (server/ws-phase35.mjs) and ui-smoke (stage-e). The server reaches it through CW_FAKE_FORGE_FILE
// ({ "github.fake": origin, "gitlab.fake": origin }). Tokens: GitHub `Bearer gh-test`, GitLab `private-token: gl-test`.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const FIX = path.join(__dirname, '..', 'server', 'src', 'vcs', '__fixtures__');
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8'));
const REPLY_MARK = '<!-- claude-web:reply -->';

function githubComments() {
  return { viewer: { login: 'me' }, repository: { pullRequest: {
    reviewThreads: { nodes: [
      { id: 'T1', isResolved: false, path: 'src/a.ts', line: 12, originalLine: 10, comments: { nodes: [
        { databaseId: 101, author: { login: 'alice', __typename: 'User' }, body: '这里要判空', url: 'https://github.fake/acme/app/pull/12#r101', createdAt: '2026-10-20T01:00:00Z', diffHunk: '@@ -8,4 +8,6 @@\n a\n+b' }] } },
      { id: 'T2', isResolved: true, path: 'src/b.ts', line: 3, comments: { nodes: [
        { databaseId: 102, author: { login: 'alice', __typename: 'User' }, body: 'done', url: 'u102', createdAt: '2026-10-20T01:00:00Z' }] } },
    ] },
    comments: { nodes: [
      { databaseId: 201, author: { login: 'dependabot', __typename: 'Bot' }, body: 'bump', url: 'https://github.fake/acme/app/pull/12#c201', createdAt: '2026-10-21T00:00:00Z' },
      { databaseId: 202, author: null, body: 'ghost', url: 'https://github.fake/acme/app/pull/12#c202', createdAt: '2026-10-21T00:00:00Z' },
      { databaseId: 203, author: { login: 'me', __typename: 'User' }, body: `已在 abc1234 修改\n\n${REPLY_MARK}`, url: 'u203', createdAt: '2026-10-21T01:00:00Z' },
    ] },
  } } };
}

const gitlabDiscussions = () => [
  { id: 'd1', individual_note: false, notes: [{ id: 301, system: false, resolvable: true, resolved: false, author: { id: 7, username: 'carol' }, body: '少了测试', created_at: '2026-10-22T00:00:00Z', position: { new_path: 'lib/x.rb', new_line: 40 } }] },
  { id: 'd2', individual_note: true, notes: [{ id: 302, system: false, resolvable: false, resolved: false, author: { id: 8, username: 'project_12_bot3' }, body: 'pipeline note', created_at: '2026-10-22T01:00:00Z' }] },
  { id: 'd3', individual_note: true, notes: [{ id: 303, system: true, author: { id: 7, username: 'carol' }, body: 'added 1 commit', created_at: '2026-10-22T02:00:00Z' }] },
];

function startFakeForge() {
  const calls = [];
  const state = { mergeWhenPipeline: true };
  const server = http.createServer((q, s) => {
    let raw = '';
    q.on('data', (c) => { raw += c; });
    q.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      const url = new URL(q.url, 'http://x');
      const p = decodeURIComponent(url.pathname);
      calls.push({ method: q.method, path: url.pathname + url.search, body });
      const json = (status, o) => s.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(o));
      // ---- GitHub
      if (p.startsWith('/api/v3/') || p === '/api/graphql') {
        if (q.headers.authorization !== 'Bearer gh-test') return json(401, { message: 'Bad credentials' });
        if (p === '/api/graphql') {
          const query = String(body?.query ?? '');
          if (query.includes('pullRequests(headRefName')) return json(200, { data: { repository: { defaultBranchRef: { name: 'main' }, pullRequests: { nodes: fixture('github-pr-nodes.json') } } } });
          if (query.includes('reviewThreads')) return json(200, { data: githubComments() });
          if (query.includes('PullRequestAutoMerge')) return json(200, { data: { x: { clientMutationId: null } } });
          if (query.includes('resolveReviewThread')) return json(200, { data: { resolveReviewThread: { thread: { id: 'T1' } } } });
          return json(200, { errors: [{ message: 'unknown query' }] });
        }
        const perm = /^\/api\/v3\/repos\/acme\/app\/collaborators\/([^/]+)\/permission$/.exec(p);
        if (perm) return json(200, perm[1] === 'alice' ? { permission: 'write', role_name: 'write' } : { permission: 'read', role_name: 'read' });
        if (q.method === 'POST' && p === '/api/v3/repos/acme/app/pulls/12/comments/101/replies') return json(201, { id: 999 });
        if (q.method === 'POST' && p === '/api/v3/repos/acme/app/issues/12/comments') return json(201, { id: 998 });
        return json(404, { message: 'Not Found' });
      }
      // ---- GitLab
      if (p.startsWith('/api/v4/')) {
        if (q.headers['private-token'] !== 'gl-test') return json(401, { message: '401 Unauthorized' });
        const pr = '/api/v4/projects/acme/app';
        if (p === pr) return json(200, { id: 77, default_branch: 'main' });
        if (p === `${pr}/merge_requests` && q.method === 'GET') return json(200, fixture('gitlab-mr-list.json'));
        if (p === `${pr}/merge_requests/5` && q.method === 'GET') return json(200, { ...fixture('gitlab-mr.json'), merge_when_pipeline_succeeds: state.mergeWhenPipeline });
        if (p === `${pr}/pipelines/444/jobs`) return json(200, fixture('gitlab-jobs.json'));
        if (p === `${pr}/jobs/1005/trace`) return s.writeHead(200, { 'content-type': 'text/plain' }).end(['\u001b[32;1m$ npm test\u001b[0;m', ...Array.from({ length: 300 }, (_, i) => `line ${i}`)].join('\n'));
        if (p === `${pr}/merge_requests/5/discussions`) return json(200, gitlabDiscussions());
        if (p === `${pr}/members/all/7`) return json(200, { id: 7, access_level: 30 });
        if (p.startsWith(`${pr}/members/all/`)) return json(404, { message: '404 Not found' });
        if (q.method === 'PUT' && p === `${pr}/merge_requests/5/merge`) { state.mergeWhenPipeline = true; return json(200, { iid: 5 }); }
        if (q.method === 'POST' && p === `${pr}/merge_requests/5/cancel_merge_when_pipeline_succeeds`) { state.mergeWhenPipeline = false; return json(200, { iid: 5 }); }
        if (q.method === 'POST' && /\/merge_requests\/5\/discussions\/[^/]+\/notes$/.test(p)) return json(201, { id: 700 });
        if (q.method === 'PUT' && /\/merge_requests\/5\/discussions\/[^/]+$/.test(p)) return json(200, { id: 'd1', resolved: true });
        return json(404, { message: '404 Not found' });
      }
      return json(404, { message: 'nothing here' });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({ origin, calls, state, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

module.exports = { startFakeForge, REPLY_MARK };
