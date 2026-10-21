// Phase 30 end-to-end (2026-10-19): the embedded gateway's phase A over a real server and a fake Anthropic
// upstream (no model, no token):
//   · the root /v1 routes and the explicit /<group>/v1 route;
//   · a Claude subscription account in a pool, used as a gateway member: Bearer + oauth beta + the Claude Code
//     system prefix, never x-api-key;
//   · key groups: the migrated default key, a restricted group (403), an RPM limit (429);
//   · the LAN listener: the data plane only, allowLan required, no admin surface;
//   · the audit log: lines for the requests, and never the prompt or a key.
//   node server/ws-phase30.mjs   (starts its own server; scripts/e2e.mjs' port/token are ignored)
import WebSocket from 'ws';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-phase30-'));
const home = path.join(root, 'home');
fs.mkdirSync(home, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, !!ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const until = async (fn, ms, step = 200) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, step));
  }
};

// ---- the fake upstream: records what it saw, answers Anthropic-shaped ----
const seen = [];
let n = 0;
const json = (s, status, o) => s.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(o));
const upstream = http.createServer((q, s) => {
  let raw = '';
  q.on('data', (c) => { raw += c; });
  q.on('end', () => {
    seen.push({ url: q.url ?? '', method: q.method ?? '', headers: q.headers, body: raw });
    if ((q.url ?? '').includes('/models')) return json(s, 200, { data: [{ id: 'claude-sonnet-4-6', type: 'model' }] });
    let j = {};
    try { j = JSON.parse(raw || '{}'); } catch { /* keep */ }
    json(s, 200, {
      id: `msg_${++n}`, type: 'message', role: 'assistant', model: j.model,
      content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 2 },
    });
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const up = `http://127.0.0.1:${upstream.address().port}`;

// ---- the server: throwaway HOME, no proxy, the account probe pointed at the fake ----
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
  CW_CLAUDE_BASE: up,
  CLAUDE_WEB_SYSTEM_LANG: 'zh-CN',
};
for (const k of Object.keys(env)) {
  if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR|OPENAI_|GEMINI_|GROK_|XAI_)/.test(k)) delete env[k];
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

const call = async (url, key, body, headers = {}) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, headers: r.headers, text: await r.text() };
};

async function main() {
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  await req({ kind: 'settings.set', key: 'network.proxy', value: 'off' });

  const provider = await req({
    kind: 'providers.upsert',
    provider: { name: 'Fake relay', type: 'anthropic', baseUrl: up, apiKey: 'sk-fake', defaultModel: 'claude-sonnet-4-6', models: ['claude-sonnet-4-6'] },
  });
  await req({ kind: 'gateway.set', enabled: true });
  await req({ kind: 'gateway.groups.upsert', group: { id: 'main', name: 'Main', strategy: 'failover', members: [{ providerId: provider.id }] } });

  // ---- the migrated default key ----
  const ks = await req({ kind: 'gateway.keys.status' });
  const def = ks.keys.find((k) => k.id === 'key_default');
  check('the old single key is migrated into a default key group', !!def && ks.groups.some((g) => g.id === 'default'), JSON.stringify(ks).slice(0, 200));
  const legacyKey = await req({ kind: 'gateway.keys.reveal', id: 'key_default' });
  check('… and is still revealable (显示密钥 keeps working)', typeof legacyKey === 'string' && legacyKey.startsWith('cwg-'), String(legacyKey).slice(0, 8));

  // ---- root and explicit routes ----
  const rootCall = await call(`${base}/v1/messages`, legacyKey, { model: 'claude-sonnet-4-6', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] });
  check('root /v1/messages (one route group: no prefix needed)', rootCall.status === 200, `${rootCall.status} ${rootCall.text.slice(0, 120)}`);
  const explicit = await call(`${base}/main/v1/messages`, legacyKey, { model: 'claude-sonnet-4-6', max_tokens: 8, messages: [] });
  check('explicit /<group>/v1/messages', explicit.status === 200, `${explicit.status} ${explicit.text.slice(0, 120)}`);
  const health = await fetch(`${base}/healthz`);
  check('/healthz', health.status === 200 && (await health.json()).ok === true);

  // ---- a Claude account in a pool ----
  const added = await req({ kind: 'upstreams.add', input: { kind: 'claude', name: 'Sub', credential: 'sk-ant-oat01-test' } });
  check('a subscription account is added and probed', added?.account?.health === 'ok', JSON.stringify(added).slice(0, 200));
  await req({ kind: 'upstreams.groups.upsert', group: { id: 'pool', kind: 'claude', name: 'Pool', strategy: 'failover', members: [added.id] } });
  await req({ kind: 'gateway.groups.upsert', group: { id: 'acct', name: 'Acct', strategy: 'failover', members: [{ upstreamGroupId: 'pool' }] } });
  const seenBefore = seen.length;
  const acct = await call(`${base}/acct/v1/messages`, legacyKey, { model: 'claude-sonnet-4-6', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] });
  check('a pool member answers', acct.status === 200, `${acct.status} ${acct.text.slice(0, 120)}`);
  const accountReq = seen.slice(seenBefore).find((x) => x.url.startsWith('/v1/messages') && x.headers.authorization === 'Bearer sk-ant-oat01-test');
  check('… with Bearer + the oauth beta, no x-api-key', accountReq
    && String(accountReq.headers['anthropic-beta'] ?? '').includes('oauth-2025-04-20')
    && accountReq.headers['x-api-key'] === undefined, JSON.stringify(accountReq?.headers ?? {}).slice(0, 200));
  check('… and the Claude Code system prefix', !!accountReq && accountReq.body.includes('You are Claude Code'));

  // ---- key groups ----
  const restricted = await req({ kind: 'gateway.keyGroups.upsert', group: { id: 'restricted', name: 'R', routeGroupIds: ['acct'] } });
  const restrictedKey = await req({ kind: 'gateway.keys.create', groupId: restricted.id, name: 'restricted' });
  check('a new key is returned once as plaintext, stored hashed', restrictedKey.plaintext.startsWith('cwg-') && restrictedKey.key.hash === undefined, JSON.stringify(restrictedKey.key).slice(0, 120));
  const denied = await call(`${base}/main/v1/messages`, restrictedKey.plaintext, { model: 'claude-sonnet-4-6', max_tokens: 1, messages: [] });
  check('a key group may name the route groups it can use (403 otherwise)', denied.status === 403, `${denied.status} ${denied.text.slice(0, 120)}`);

  await req({ kind: 'gateway.keyGroups.upsert', group: { id: 'slow', name: 'Slow', routeGroupIds: ['main'], rateLimit: { rpm: 1 } } });
  const slowKey = await req({ kind: 'gateway.keys.create', groupId: 'slow', name: 'slow' });
  const one = await call(`${base}/main/v1/messages`, slowKey.plaintext, { model: 'claude-sonnet-4-6', max_tokens: 1, messages: [] });
  const two = await call(`${base}/main/v1/messages`, slowKey.plaintext, { model: 'claude-sonnet-4-6', max_tokens: 1, messages: [] });
  check('the key group\'s RPM limit answers 429 with retry-after', one.status === 200 && two.status === 429 && !!two.headers.get('retry-after'), `${one.status}/${two.status}`);

  // ---- LAN ----
  await req({ kind: 'gateway.keyGroups.upsert', group: { id: 'lan', name: 'LAN', routeGroupIds: ['main'], allowLan: true, ipAllowlist: ['127.0.0.0/8'] } });
  const lanKey = await req({ kind: 'gateway.keys.create', groupId: 'lan', name: 'lan' });
  const lan = await req({ kind: 'gateway.lan.set', config: { enabled: true, bind: '127.0.0.1', port: 0 } });
  check('the LAN listener is up on its own port', lan.running && lan.port > 0, JSON.stringify(lan).slice(0, 160));
  const lanBase = `http://127.0.0.1:${lan.port}`;
  const lanOk = await call(`${lanBase}/v1/messages`, lanKey.plaintext, { model: 'claude-sonnet-4-6', max_tokens: 1, messages: [] });
  check('… and serves the data plane for a key that allows LAN', lanOk.status === 200, `${lanOk.status}`);
  const admin = await fetch(`${lanBase}/gateway/main/v1/messages`, { method: 'POST', headers: { 'x-api-key': lanKey.plaintext }, body: '{}' });
  check('… with no admin surface (404 on /gateway/…)', admin.status === 404, String(admin.status));
  const lanDenied = await call(`${lanBase}/v1/messages`, legacyKey, { model: 'claude-sonnet-4-6', max_tokens: 1, messages: [] });
  check('… and the default key group may not use it', lanDenied.status === 403, `${lanDenied.status} ${lanDenied.text.slice(0, 120)}`);

  // ---- audit ----
  const logs = await until(async () => {
    const l = await req({ kind: 'gateway.audit.list', limit: 200 });
    return l.length ? l : null;
  }, 5000);
  check('the audit log has the requests', Array.isArray(logs) && logs.length >= 4, String(logs?.length));
  const text = JSON.stringify(logs ?? []);
  check('… never the prompt', !text.includes('"hi"') && !text.includes('hi'), text.slice(0, 240));
  check('… never a key', !text.includes(legacyKey) && !text.includes(restrictedKey.plaintext) && !text.includes(lanKey.plaintext));
  check('… and only whitelisted fields', (logs ?? []).every((l) => Object.keys(l).sort().join(',') === 'errorCode,ip,keyId,member,model,ms,protocol,routeGroupId,status,tokensIn,tokensOut,ts'), JSON.stringify(Object.keys(logs?.[0] ?? {})));

  await req({ kind: 'gateway.lan.set', config: { enabled: false } });
}

try {
  await main();
} catch (e) {
  check('ran without throwing', false, e?.stack ?? String(e));
} finally {
  ws.close();
  server.kill();
  upstream.close();
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\nphase30: ${results.length - failed}/${results.length} passed`);
  if (failed) console.log(slog.split('\n').slice(-30).join('\n'));
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* windows may still hold a handle */ }
  process.exit(failed ? 1 : 0);
}
