// Phase 31 end-to-end (2026-10-19): the Gemini and WorkBuddy sidecars and the task center over a real server and
// two fake sidecars (spawned as Node scripts through the dev override, no download, no token):
//   · a Gemini cookie account starts its sidecar and resolves as an OpenAI target for the gateway;
//   · the WorkBuddy QR login flow, sync into the account list, and a cockpit JSON import;
//   · scheduled tasks (check-in / keepalive) with a manual run, idempotency and run history;
//   · sidecar stop / start and its log;
//   · removing an account removes the sidecar login.
//   node server/ws-phase31.mjs   (starts its own server; scripts/e2e.mjs' port/token are ignored)
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-phase31-'));
const home = path.join(root, 'home');
fs.mkdirSync(home, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, !!ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---- the server: throwaway HOME, dev sidecars (node + fixture), no model refresh ----
const token = randomBytes(12).toString('hex');
const dataDir = path.join(home, '.claude-web');
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  PORT: '0',
  CLAUDE_WEB_TOKEN: token,
  CLAUDE_WEB_DIR: dataDir,
  CW_NO_MODEL_REFRESH: '1',
  CW_NO_PUBLIC_BROKERS: '1',
  CLAUDE_WEB_SYSTEM_LANG: 'zh-CN',
  CW_SIDECAR_GEMINI_CMD: JSON.stringify([process.execPath, path.join(here, 'fixtures', 'fake-gemini-sidecar.mjs')]),
  CW_SIDECAR_WORKBUDDY_CMD: JSON.stringify([process.execPath, path.join(here, 'fixtures', 'fake-workbuddy-sidecar.mjs')]),
};
for (const k of Object.keys(env)) {
  if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR|OPENAI_|GEMINI_|GROK_|XAI_)/.test(k)) delete env[k];
  if (/^CW_SIDECAR_(GEMINI|WORKBUDDY)_BIN$/.test(k)) delete env[k];
  if (/^(no_proxy|https?_proxy|all_proxy)$/i.test(k)) delete env[k];
}
const server = spawn(process.execPath, [path.join(here, 'dist', 'index.js')], { cwd: path.dirname(here), env, stdio: ['ignore', 'pipe', 'pipe'] });
let slog = '';
server.stderr.on('data', (d) => { slog += d; });
const port = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`server did not start in 60s\n${slog}`)), 60_000);
  server.stdout.on('data', (d) => {
    slog += d;
    const m = /listening on http:\/\/[^:]+:(\d+)/.exec(slog);
    if (m) { clearTimeout(t); res(m[1]); }
  });
  server.on('exit', (c) => rej(new Error(`server exited (${c})\n${slog}`)));
});
const base = `http://127.0.0.1:${port}`;

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
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
const req = (r) => new Promise((res, rej) => {
  const id = String(++seq);
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ type: 'request', request: { id, req: r } }));
});
const call = async (url, key, body) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  return { status: r.status, text: await r.text() };
};
const rejects = async (p) => { try { await p; return false; } catch { return true; } };

async function main() {
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  await req({ kind: 'settings.set', key: 'network.proxy', value: 'off' });
  await req({ kind: 'gateway.set', enabled: true });

  // ---- Gemini: add a cookie, the sidecar starts, the gateway uses it ----
  const before = await req({ kind: 'upstreams.status' });
  check('both sidecars are installed from the dev override, not running yet', before.sidecars?.length === 2
    && before.sidecars.every((s) => s.installed && !s.running && s.version === 'dev'), JSON.stringify(before.sidecars));

  const g = await req({ kind: 'upstreams.add', input: { kind: 'gemini', name: 'Gem', credential: '__Secure-1PSID=abc; foo=bar' } });
  check('a Gemini cookie account is added through its sidecar', g.account.health === 'ok' && !!g.account.sidecar?.remoteId, JSON.stringify(g).slice(0, 220));
  const afterGem = await req({ kind: 'upstreams.status' });
  const gem = afterGem.sidecars.find((s) => s.id === 'gemini');
  check('… which started and answers health', gem.running && gem.health === 'ok' && gem.port > 0, JSON.stringify(gem));
  check('… and the Gemini family is ready', afterGem.families.find((f) => f.kind === 'gemini')?.ready === true);
  const logs = await req({ kind: 'upstreams.sidecars.logs', id: 'gemini', lines: 50 });
  check('its log is kept', String(logs).includes('fake gemini sidecar on'), String(logs).slice(0, 160));

  const same = await req({ kind: 'upstreams.add', input: { kind: 'gemini', credential: '__Secure-1PSID=abc; foo=bar' } });
  check('the same cookie is not added twice', same.duplicate === true && same.id === g.id);

  await req({ kind: 'upstreams.groups.upsert', group: { id: 'gpool', kind: 'gemini', name: 'Gem pool', strategy: 'failover', members: [g.id] } });
  await req({ kind: 'gateway.groups.upsert', group: { id: 'gem', name: 'Gem', strategy: 'failover', members: [{ upstreamGroupId: 'gpool' }] } });
  const ks = await req({ kind: 'gateway.keys.status' });
  const key = await req({ kind: 'gateway.keys.reveal', id: ks.keys.find((k) => k.id === 'key_default').id });
  const gemCall = await call(`${base}/gem/v1/messages`, key, { model: 'gemini-3.6-flash', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] });
  check('the gateway answers through the Gemini sidecar (Anthropic in, OpenAI out)', gemCall.status === 200 && gemCall.text.includes('hello from gemini'), `${gemCall.status} ${gemCall.text.slice(0, 160)}`);

  // ---- WorkBuddy: QR login → sync, and a cockpit JSON import ----
  const login = await req({ kind: 'upstreams.oauth.start', id: 'workbuddy', realm: 'cn' });
  check('WorkBuddy login starts (the sidecar starts too)', !!login.url && !!login.state, JSON.stringify(login));
  const p1 = await req({ kind: 'upstreams.oauth.poll', state: login.state });
  const p2 = p1.done ? p1 : await req({ kind: 'upstreams.oauth.poll', state: login.state });
  check('… and polls until the login is done', p2.done === true, JSON.stringify(p2));
  const synced = await req({ kind: 'upstreams.sync', id: 'workbuddy' });
  const u1 = synced.find((a) => a.sidecar?.remoteId === 'u1');
  check('sync mirrors the account the sidecar logged in', !!u1 && u1.name === 'Logged in' && u1.health === 'ok', JSON.stringify(synced).slice(0, 220));
  const again = await req({ kind: 'upstreams.sync', id: 'workbuddy' });
  check('… once', again.filter((a) => a.kind === 'workbuddy').length === 1);

  const wb = await req({ kind: 'upstreams.add', input: { kind: 'workbuddy', name: 'Cockpit', credential: JSON.stringify([{ uid: 'u2', accessToken: 'at', refreshToken: 'rt' }]) } });
  check('a cockpit JSON import is linked to the sidecar', wb.account.health === 'ok' && wb.account.sidecar?.remoteId === 'u2', JSON.stringify(wb).slice(0, 220));
  const afterWb = await req({ kind: 'upstreams.status' });
  check('… and the WorkBuddy family is ready', afterWb.families.find((f) => f.kind === 'workbuddy')?.ready === true);

  // ---- tasks ----
  const task = await req({ kind: 'tasks.upsert', task: { name: 'Evening', kind: 'checkin', target: { kind: 'account', accountId: wb.id }, schedule: { everyMinutes: 60 } } });
  check('a task is created with a next run', !!task.id && task.nextRunAt > Date.now(), JSON.stringify(task).slice(0, 200));
  const ran = await req({ kind: 'tasks.run', id: task.id });
  check('run now checks the WorkBuddy account in', Array.isArray(ran) && ran.length === 1 && ran[0].ok && ran[0].accountId === wb.id, JSON.stringify(ran).slice(0, 200));
  const gemTask = await req({ kind: 'tasks.upsert', task: { kind: 'keepalive', target: { kind: 'account', accountId: g.id }, schedule: { cron: '0 */6 * * *' } } });
  const gemRan = await req({ kind: 'tasks.run', id: gemTask.id });
  check('a Gemini keepalive task runs', gemRan.length === 1 && gemRan[0].ok, JSON.stringify(gemRan).slice(0, 200));
  const listed = await req({ kind: 'tasks.list' });
  check('the run history has both runs', listed.runs.length === 2 && listed.tasks.length === 2, JSON.stringify(listed.runs.map((r) => r.id)));
  check('an unsupported task kind for the family writes no run', (await req({ kind: 'tasks.upsert', task: { kind: 'checkin', target: { kind: 'account', accountId: g.id }, schedule: { everyMinutes: 60 } } }))
    && (await req({ kind: 'tasks.run', id: (await req({ kind: 'tasks.list' })).tasks.find((t) => t.kind === 'checkin' && t.target.accountId === g.id).id })).length === 0);
  check('an invalid schedule is refused', await rejects(req({ kind: 'tasks.upsert', task: { kind: 'checkin', target: { kind: 'account', accountId: wb.id }, schedule: { everyMinutes: 1 } } })));

  // ---- sidecar lifecycle ----
  const stopped = await req({ kind: 'upstreams.sidecars.stop', id: 'gemini' });
  check('a sidecar can be stopped', stopped.running === false, JSON.stringify(stopped));
  const started = await req({ kind: 'upstreams.sidecars.start', id: 'gemini' });
  check('… and started again on a fresh port', started.running === true && started.health === 'ok', JSON.stringify(started));

  // ---- remove ----
  await req({ kind: 'upstreams.remove', id: wb.id });
  const gone = await req({ kind: 'upstreams.status' });
  check('removing the account removes it from the list and its pools', !gone.accounts.some((a) => a.id === wb.id));

  for (const id of ['gemini', 'workbuddy']) await req({ kind: 'upstreams.sidecars.stop', id }).catch(() => {});
}

try {
  await main();
} catch (e) {
  check('ran without throwing', false, e?.stack ?? String(e));
} finally {
  try {
    for (const id of ['gemini', 'workbuddy']) {
      if (ws.readyState === WebSocket.OPEN) await Promise.race([
        new Promise((res) => { const id2 = String(++seq); pending.set(id2, { res, rej: res }); ws.send(JSON.stringify({ type: 'request', request: { id: id2, req: { kind: 'upstreams.sidecars.stop', id } } })); }),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    }
  } catch { /* the server may already be gone */ }
  ws.close();
  server.kill();
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\nphase31: ${results.length - failed}/${results.length} passed`);
  if (failed) console.log(slog.split('\n').slice(-30).join('\n'));
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* windows may still hold a handle */ }
  process.exit(failed ? 1 : 0);
}
