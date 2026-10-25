// Phase 37 end-to-end (stage F1): 交给常开机器继续 with a second local Claude Web as the always-on machine.
// A is the server scripts/e2e.mjs started (port / token in argv; HOME is its temp HOME); this script starts B with its
// own temp HOME + CLAUDE_WEB_DIR, pairs A with B, marks B always-on, makes a temp Git repo whose remote is a temp
// BARE repo (never a real remote), writes a Claude transcript for A in it, then: handoff.check / handoff.start →
// the branch on the bare remote, B's worktree with the uncommitted work and a new conversation there, A's branch /
// index / work tree byte-identical, the conversation read-only on A; B changes a file → 取回 → a new local branch
// with the diff, nothing merged; a conversation on another machine can't be handed off.
//   node server/ws-phase37.mjs [port] [token]
import WebSocket from 'ws';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const portA = args[0] ?? '3090';
const tokenA = args[1];
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const results = [];
const check = (name, ok, detail = '') => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '0.0.0.0', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const until = async (fn, ms = 30000, step = 300) => { const t = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t > ms) return null; await sleep(step); } };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).replace(/\r?\n$/, '');

function client(url) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type === 'reply') { const p = pending.get(m.reply.id); pending.delete(m.reply.id); m.reply.ok ? p.res(m.reply.data) : p.rej(new Error(m.reply.error)); return; }
    if (m.type === 'event') events.push(m.event);
  });
  const req = (r) => new Promise((res, rej) => { const id = String(++seq); pending.set(id, { res, rej }); ws.send(JSON.stringify({ type: 'request', request: { id, req: r } })); });
  const open = new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  return { ws, req, events, open };
}

// ---- the repo, its bare remote, A's conversation in it ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-e2e-handoff-'));
const bare = path.join(tmp, 'remote.git');
const repo = path.join(tmp, 'repo');
git(tmp, 'init', '-q', '--bare', '-b', 'main', bare);
git(tmp, 'init', '-q', '-b', 'main', repo);
fs.writeFileSync(path.join(repo, 'parser.js'), 'export const x = 1;\n');
git(repo, 'add', '.');
git(repo, '-c', 'user.name=e2e', '-c', 'user.email=e2e@e2e', 'commit', '-q', '-m', 'init');
git(repo, 'remote', 'add', 'origin', bare);
git(repo, 'push', '-q', 'origin', 'main');
fs.writeFileSync(path.join(repo, 'parser.js'), 'export const x = 2; // half done\n');
fs.writeFileSync(path.join(repo, 'notes.md'), 'todo: tests\n');
const hashTree = (dir) => { const h = crypto.createHash('sha256'); const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { if (n === '.git') continue; const p = path.join(d, n); h.update(path.relative(dir, p)); if (fs.lstatSync(p).isDirectory()) walk(p); else h.update(fs.readFileSync(p)); } }; walk(dir); return h.digest('hex'); };
const state = () => ({ index: crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, '.git', 'index'))).digest('hex'), head: fs.readFileSync(path.join(repo, '.git', 'HEAD'), 'utf8'), sha: git(repo, 'rev-parse', 'HEAD'), tree: hashTree(repo), stash: git(repo, 'stash', 'list'), status: git(repo, 'status', '--porcelain') });

const sid = crypto.randomUUID();
const { toClaudeEntries } = await import(pathToFileURL(path.join(here, 'dist', 'session', 'handoff.js')).href);
const { writeClaudeTranscript } = await import(pathToFileURL(path.join(here, 'dist', 'runtime', 'transcript-file.js')).href);
writeClaudeTranscript(repo, sid, toClaudeEntries([{ t: 0, kind: 'user', text: 'please fix the parser' }, { t: 0, kind: 'assistant', text: 'on it — half done' }], { cwd: repo, sessionId: sid }));

// ---- start B ----
const homeB = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-e2e-b37-'));
const tokenB = crypto.randomBytes(12).toString('hex');
const envB = { ...process.env, HOME: homeB, USERPROFILE: homeB, PORT: '0', CLAUDE_WEB_TOKEN: tokenB, CLAUDE_WEB_DIR: path.join(homeB, '.claude-web') };
for (const k of Object.keys(envB)) if (/^(ANTHROPIC_|CLAUDE_CODE_)/.test(k)) delete envB[k];
const serverB = spawn(process.execPath, [path.join(here, 'dist', 'index.js')], { cwd: root, env: envB, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let logB = '';
serverB.stderr.on('data', (d) => { logB += d; });
const portB = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`server B did not start\n${logB}`)), 60_000);
  serverB.stdout.on('data', (d) => { logB += d; const m = /listening on http:\/\/[^:]+:(\d+)/.exec(logB); if (m) { clearTimeout(t); res(m[1]); } });
});
console.log(`server B on :${portB} (HOME=${homeB})`);

const A = client(`ws://127.0.0.1:${portA}/ws${tokenA ? `?token=${tokenA}` : ''}`);
const B = client(`ws://127.0.0.1:${portB}/ws?token=${tokenB}`);
await Promise.all([A.open, B.open]);
try {
  // ---- pair, always-on ----
  const remotePort = await freePort();
  const st = await B.req({ kind: 'remote.set', enabled: true, port: remotePort });
  check('B: remote listener up', st.running, st.error);
  const pc = await B.req({ kind: 'remote.pairCode' });
  const peer = await A.req({ kind: 'peers.add', url: `http://127.0.0.1:${remotePort}`, code: pc.code });
  const online = await until(async () => (await A.req({ kind: 'peers.list' })).find((p) => p.id === peer.id && p.state === 'online') ?? null);
  check('A: paired with B', !!online, peer.state);
  await A.req({ kind: 'peers.update', id: peer.id, patch: { alwaysOn: true } });
  const always = (await A.req({ kind: 'peers.list' })).find((p) => p.id === peer.id);
  check('A: B marked always-on (peers.update alwaysOn)', always?.alwaysOn === true);

  // ---- A's conversation is listed ----
  const listed = await until(async () => (await A.req({ kind: 'sessions.list' })).find((s) => s.sessionId === sid) ?? null, 30000);
  check("A: the conversation in the temp repo is in A's list", !!listed, listed?.cwd);
  const chk = await A.req({ kind: 'handoff.check', sessionId: sid });
  check('handoff.check: a Git project with a remote can be handed off', chk.ok === true && typeof chk.remote === 'string', JSON.stringify(chk));
  // fix wave F2: the new untracked file is listed (carried only when ticked)
  check('handoff.check: lists the new untracked files the user can tick in', chk.untracked?.files?.some((f) => f.path === 'notes.md'), JSON.stringify(chk.untracked ?? null));
  const plainDir = path.join(tmp, 'plain'); fs.mkdirSync(plainDir);
  const sidPlain = crypto.randomUUID();
  writeClaudeTranscript(plainDir, sidPlain, toClaudeEntries([{ t: 0, kind: 'user', text: 'not git' }], { cwd: plainDir, sessionId: sidPlain }));
  await until(async () => (await A.req({ kind: 'sessions.list' })).some((s) => s.sessionId === sidPlain), 30000);
  const chkPlain = await A.req({ kind: 'handoff.check', sessionId: sidPlain });
  check('handoff.check: a folder that is not a Git project says why', chkPlain.ok === false && !!chkPlain.reason, chkPlain.reason);

  // ---- hand off ----
  const before = state();
  // the user ticked 「也带上 N 个新文件」 (fix wave F2: untracked files go only then)
  const info = await A.req({ kind: 'handoff.start', sessionId: sid, peerId: peer.id, includeUntracked: true });
  const after = state();
  check("handoff.start: A's branch, index, work tree, stash and status are untouched", JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before: before.status, after: after.status }));
  check('handoff.start: a cw/handoff-<id> branch on the (temp, bare) remote', /^cw\/handoff-[0-9a-f]{8}$/.test(info.branch) && git(bare, 'rev-parse', `refs/heads/${info.branch}`) === info.commit, info.branch);
  check('the snapshot has the uncommitted and the untracked work, parent = HEAD', git(bare, 'show', `${info.commit}:parser.js`).includes('half done') && git(bare, 'show', `${info.commit}:notes.md`).includes('todo') && git(bare, 'rev-parse', `${info.commit}^`) === before.sha);
  check("the remote's main did not move (never forced)", git(bare, 'rev-parse', 'refs/heads/main') === before.sha);
  const metaA = await A.req({ kind: 'sessions.meta' });
  check('A: the conversation is marked handed off (read-only here)', metaA[sid]?.handedOff?.branch === info.branch && metaA[sid].handedOff.peerName === online.name, JSON.stringify(metaA[sid]?.handedOff ?? null));
  const again = await A.req({ kind: 'handoff.check', sessionId: sid });
  check('handoff.check: a handed-off conversation cannot go again', again.ok === false);

  // ---- B: its worktree + conversation ----
  const wt = path.join(homeB, '.claude-web', 'handoff', 'worktrees', info.id);
  check("B: a worktree of the branch under B's own data dir, with the uncommitted work", fs.existsSync(path.join(wt, 'parser.js')) && fs.readFileSync(path.join(wt, 'parser.js'), 'utf8').includes('half done') && fs.existsSync(path.join(wt, 'notes.md')), wt);
  const bRow = await until(async () => (await B.req({ kind: 'sessions.list' })).find((s) => s.sessionId === info.remoteSessionId) ?? null, 30000);
  check("B: the handed-off conversation is in B's list, in the worktree", !!bRow && path.resolve(bRow.cwd).toLowerCase() === path.resolve(wt).toLowerCase(), bRow?.cwd);
  const bHist = await B.req({ kind: 'library.read', sessionId: info.remoteSessionId, limit: 50 }).catch(() => null);
  check("B: the conversation carries A's history", !!bHist && JSON.stringify(bHist).includes('please fix the parser'));
  const bMeta = await B.req({ kind: 'sessions.meta' });
  check('B: marked as handed off from A', bMeta[info.remoteSessionId]?.handoffFrom?.branch === info.branch);
  const aSeesB = await until(async () => (await A.req({ kind: 'sessions.list' })).find((s) => s.sessionId === `peer_${peer.id}~${info.remoteSessionId}`) ?? null, 30000);
  check("A: B's new conversation shows up in A's list (打开那边的对话)", !!aSeesB);
  const peerChk = await A.req({ kind: 'handoff.check', sessionId: `peer_${peer.id}~${info.remoteSessionId}` }).then((r) => r.ok, (e) => `refused: ${e.message}`);
  check('a conversation on another machine cannot be handed off from here', peerChk !== true, String(peerChk));

  // ---- 取回 ----
  fs.writeFileSync(path.join(wt, 'parser.js'), 'export const x = 3; // done on B\n');
  const before2 = state();
  const back = await A.req({ kind: 'handoff.fetchBack', sessionId: sid });
  const after2 = state();
  check('取回: B pushed its work, A fetched it into a new local branch with the diff', back.saved === true && back.branch === info.branch && back.diff.includes('done on B') && back.files >= 1, `${back.branch} files=${back.files}`);
  check('取回: nothing merged or checked out (A unchanged)', JSON.stringify(before2) === JSON.stringify(after2) && git(repo, 'rev-parse', '--abbrev-ref', 'HEAD') === 'main');
  check('取回: B pushed fast-forward on the hand-off branch', git(bare, 'rev-parse', `${git(bare, 'rev-parse', `refs/heads/${info.branch}`)}^`) === info.commit);
  const back2 = await A.req({ kind: 'handoff.fetchBack', sessionId: sid });
  check('取回 again: a new branch name, the first one is not moved', back2.branch === `${info.branch}-2`, back2.branch);
} catch (e) {
  check('phase 37 ran without throwing', false, e.stack ?? String(e));
} finally {
  A.ws.close(); B.ws.close();
  serverB.kill();
  await sleep(500);
  try { fs.rmSync(homeB, { recursive: true, force: true }); } catch { /* Windows may still hold a file */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* idem */ }
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\nphase 37: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
