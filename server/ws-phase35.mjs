// Phase 35 end-to-end (2026-10-25, stage E1 / E2): the PR bar against a fake GitHub (Enterprise layout) and a fake
// GitLab on 127.0.0.1 (scripts/fake-forge.cjs; the server is pointed at it by CW_FAKE_FORGE_FILE, set by e2e.mjs).
//   · tokens saved in settings: vcs.tokens.list names hosts only, never a token;
//   · GitHub: the branch's own PR (not the fork's) with its checks; comments with who may push (alice yes, the bot and
//     a deleted account no; our own marked reply never comes back); a reply carries the mark;
//   · GitLab: the MR with its pipeline, merge when the pipeline succeeds, a failed job's log tail, discussions with
//     who may push (a Developer yes, a project bot no), a reply into the discussion;
//   · the token removed: GitLab's PR bar says not-logged-in.
//   node server/ws-phase35.mjs [port] [token]
import WebSocket from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startFakeForge } = require('../scripts/fake-forge.cjs');

const port = process.argv[2] ?? '3090';
const token = process.argv[3];
const results = [];
const check = (name, ok, detail = '') => { results.push([name, !!ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const fakeFile = process.env.CW_FAKE_FORGE_FILE;
if (!fakeFile) { console.log('FAIL CW_FAKE_FORGE_FILE is not set (run through scripts/e2e.mjs)'); process.exit(1); }
const forge = await startFakeForge();
fs.writeFileSync(fakeFile, JSON.stringify({ 'github.fake': forge.origin, 'gitlab.fake': forge.origin }));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
const repo = (remote) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-p35-'));
  git(d, 'init', '-q');
  git(d, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(d, 'remote', 'add', 'origin', remote);
  git(d, 'checkout', '-q', '-b', 'feat/retry');
  return d;
};
const ghRepo = repo('https://github.fake/acme/app.git');
const glRepo = repo('https://gitlab.fake/acme/app.git');

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${token ? `?token=${token}` : ''}`);
let seq = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type !== 'reply') return;
  const p = pending.get(m.reply.id);
  if (!p) return;
  pending.delete(m.reply.id);
  m.reply.ok ? p.res(m.reply.data) : p.rej(new Error(m.reply.error));
});
const req = (r) => new Promise((res, rej) => { const id = String(++seq); pending.set(id, { res, rej }); ws.send(JSON.stringify({ type: 'request', request: { id, req: r } })); });

try {
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  await req({ kind: 'settings.set', key: 'vcs.gitlabHosts', value: ['gitlab.fake'] });
  await req({ kind: 'vcs.tokens.set', host: 'github.fake', token: 'gh-test' });
  await req({ kind: 'vcs.tokens.set', host: 'gitlab.fake', token: 'gl-test' });
  const list = await req({ kind: 'vcs.tokens.list' });
  const listed = JSON.stringify(list);
  check('vcs.tokens.list names the hosts, never a token', list.hosts.some((h) => h.host === 'github.fake' && h.saved) && list.hosts.some((h) => h.host === 'gitlab.fake' && h.saved) && !listed.includes('gh-test') && !listed.includes('gl-test'), listed);
  const settings = JSON.stringify(await req({ kind: 'settings.get' }).catch(() => ({})));
  check('the tokens are not in the settings', !settings.includes('gh-test') && !settings.includes('gl-test'));

  // ---- GitHub
  const gh = await req({ kind: 'vcs.prForBranch', cwd: ghRepo });
  check('GitHub: the branch\'s own PR with its checks', gh.pr?.number === 12 && gh.pr.host === 'github' && gh.pr.checks.failed === 1 && gh.pr.base === 'main', JSON.stringify(gh).slice(0, 300));
  const ghc = await req({ kind: 'vcs.prComments', cwd: ghRepo, number: 12, base: 'main' });
  const byId = Object.fromEntries(ghc.comments.map((c) => [c.id, c]));
  check('GitHub comments: alice (write) trusted, the bot and the ghost not, resolved / our reply dropped',
    byId['gh:rc:101']?.trusted === true && byId['gh:ic:201']?.trusted === false && byId['gh:ic:201']?.bot === true && byId['gh:ic:202']?.trusted === false && !byId['gh:rc:102'] && !byId['gh:ic:203'], JSON.stringify(ghc.comments.map((c) => [c.id, c.trusted])));
  await req({ kind: 'vcs.replyComment', cwd: ghRepo, number: 12, comment: { id: 'gh:rc:101', kind: 'thread', threadId: 'T1', replyTo: '101' }, body: '已在 abc1234 修改' });
  const ghReply = forge.calls.find((c) => c.method === 'POST' && c.path.endsWith('/pulls/12/comments/101/replies'));
  check('GitHub reply goes under the comment with the mark', !!ghReply && String(ghReply.body?.body).includes('<!-- claude-web:reply -->'));

  // ---- GitLab
  const gl = await req({ kind: 'vcs.prForBranch', cwd: glRepo });
  check('GitLab: this project\'s MR, merge when the pipeline succeeds, the failed job', gl.pr?.host === 'gitlab' && gl.pr.number === 5 && gl.pr.autoMerge === true && gl.pr.checks.failures.map((f) => f.name).join() === 'unit', JSON.stringify(gl).slice(0, 300));
  await req({ kind: 'vcs.autoMerge', cwd: glRepo, prId: '5', on: true });
  check('GitLab: 流水线通过后合并 is a PUT …/merge', forge.calls.some((c) => c.method === 'PUT' && /merge_requests\/5\/merge$/.test(c.path)));
  const log = await req({ kind: 'vcs.failureLog', cwd: glRepo, jobId: 1005 });
  const lines = log.text.split('\n');
  check('GitLab: the job log tail (no colours, at most 150 lines, ends at the end)', lines.length <= 150 && log.text.endsWith('line 299') && !log.text.includes('\u001b'));
  const glc = await req({ kind: 'vcs.prComments', cwd: glRepo, number: 5 });
  const g = Object.fromEntries(glc.comments.map((c) => [c.id, c]));
  check('GitLab comments: carol (Developer) trusted, the project bot not, system notes dropped', g['gl:n:301']?.trusted === true && g['gl:n:302']?.trusted === false && !g['gl:n:303'], JSON.stringify(glc.comments.map((c) => [c.id, c.trusted])));
  await req({ kind: 'vcs.replyComment', cwd: glRepo, number: 5, comment: { id: 'gl:n:301', kind: 'thread', threadId: 'd1', replyTo: 'd1' }, body: '已在 abc1234 修改' });
  const glReply = forge.calls.find((c) => c.method === 'POST' && /discussions\/d1\/notes$/.test(c.path));
  check('GitLab reply goes into the discussion with the mark', !!glReply && String(glReply.body?.body).includes('<!-- claude-web:reply -->'));

  // ---- the token removed
  await req({ kind: 'vcs.tokens.set', host: 'gitlab.fake', token: null });
  const off = await req({ kind: 'vcs.prForBranch', cwd: glRepo });
  check('GitLab without a token: not-logged-in', off.why === 'not-logged-in' && !off.pr, JSON.stringify(off));
  let bad = false;
  try { await req({ kind: 'vcs.tokens.set', host: 'https://evil/x', token: 'x' }); } catch { bad = true; }
  check('a token for something that is not a host is refused', bad);
} catch (e) {
  check('phase 35 ran', false, String(e?.stack ?? e));
}
ws.close();
await forge.close();
for (const d of [ghRepo, glRepo]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* windows */ } }
const failed = results.filter(([, ok]) => !ok);
console.log(failed.length ? `\nphase 35: ${failed.length} failed` : `\nphase 35: all ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
