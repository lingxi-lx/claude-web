// Phase 29 end-to-end (2026-10-15): what came out of a user's friend's report and GitHub issue #2, over a real server
// and the real engine against a fake Anthropic upstream started here (no model, no token):
//   · the permission mode a conversation comes back in: what it last ran with (it fell back to 每步询问), else the
//     default for new conversations;
//   · history: the line under each answer for turns that did not run in this window (time · steps · cost · tokens),
//     and a long conversation paged (`transcript.load` page / cursor);
//   · custom.css (issue #2): read, made with the template, the window told when it is saved, too big = not loaded;
//   · another Claude account (`claude-account`): saved with the account's models, its token checked for its shape.
//   node server/ws-phase29.mjs   (starts its own server; scripts/e2e.mjs' port/token are ignored)
import WebSocket from 'ws';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-phase29-'));
const home = path.join(root, 'home');
fs.mkdirSync(home, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push([name, !!ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const until = async (fn, ms, step = 200) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, step)); } };

// ---- the fake upstream: every turn answers in one call, with usage ----
let n = 0;
const json = (s, status, o) => s.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(o));
const upstream = http.createServer((q, s) => {
  let raw = '';
  q.on('data', (c) => { raw += c; });
  q.on('end', () => {
    let j = {};
    try { j = JSON.parse(raw || '{}'); } catch { /* keep */ }
    const url = q.url ?? '';
    if (url.includes('/count_tokens')) return json(s, 200, { input_tokens: 10 });
    if (url.includes('/models')) return json(s, 200, { data: [{ id: 'claude-sonnet-4-6', type: 'model' }] });
    if (!url.startsWith('/v1/messages')) return json(s, 404, { error: { message: 'no' } });
    const msg = { id: `msg_${++n}`, type: 'message', role: 'assistant', model: j.model, stop_sequence: null };
    const usage = { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 3000, cache_creation_input_tokens: 500 };
    if (!j.stream) return json(s, 200, { ...msg, content: [{ type: 'text', text: 'side:ok' }], stop_reason: 'end_turn', usage });
    const ev = (type, o) => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
    s.writeHead(200, { 'content-type': 'text/event-stream' });
    s.end(ev('message_start', { message: { ...msg, content: [], stop_reason: null, usage: { ...usage, output_tokens: 1 } } })
      + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'main:ok' } }) + ev('content_block_stop', { index: 0 })
      + ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } }) + ev('message_stop', {}));
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const up = `http://127.0.0.1:${upstream.address().port}`;

// ---- the server: throwaway HOME, no proxy ----
const token = randomBytes(12).toString('hex');
const dataDir = path.join(home, '.claude-web');
const env = { ...process.env, HOME: home, USERPROFILE: home, PORT: '0', CLAUDE_WEB_TOKEN: token, CLAUDE_WEB_DIR: dataDir, CW_NO_MODEL_REFRESH: '1', CW_NO_PUBLIC_BROKERS: '1', CLAUDE_WEB_SYSTEM_LANG: 'zh-CN' };
for (const k of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR|OPENAI_|GEMINI_|GROK_|XAI_)/.test(k) || /^(no_proxy|https?_proxy|all_proxy)$/i.test(k)) delete env[k];
const server = spawn(process.execPath, [path.join(here, 'dist', 'index.js')], { cwd: path.dirname(here), env, stdio: ['ignore', 'pipe', 'pipe'] });
let slog = '';
server.stderr.on('data', (d) => { slog += d; });
const port = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`server did not start in 60s\n${slog}`)), 60_000);
  server.stdout.on('data', (d) => { slog += d; const m = /listening on http:\/\/[^:]+:(\d+)/.exec(slog); if (m) { clearTimeout(t); res(m[1]); } });
  server.on('exit', (c) => rej(new Error(`server exited (${c})\n${slog}`)));
});

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
let seq = 0;
const pending = new Map();
const events = [];
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type === 'reply') { const p = pending.get(m.reply.id); pending.delete(m.reply.id); m.reply.ok ? p.res(m.reply.data) : p.rej(new Error(m.reply.error)); return; }
  if (m.type === 'event') events.push(m.event);
});
const req = (r) => new Promise((res, rej) => { const id = String(++seq); pending.set(id, { res, rej }); ws.send(JSON.stringify({ type: 'request', request: { id, req: r } })); });
const resultOf = (sid, from, ms = 120_000) => until(() => events.slice(from).find((e) => e.kind === 'session.event' && e.sessionId === sid && e.message?.type === 'result')?.message, ms);

/** A long conversation the way Claude Code writes it: `turns` turns, each prompt `size` characters. */
function writeLong(cwd, sid, turns, size) {
  const dir = path.join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const base = { isSidechain: false, userType: 'external', cwd, sessionId: sid, version: '2.1.281', gitBranch: 'main' };
  const t0 = Date.now() - turns * 600_000;
  let parent = null;
  const rows = [];
  for (let i = 0; i < turns; i++) {
    const u = randomUUID(), a = randomUUID();
    rows.push({ ...base, parentUuid: parent, type: 'user', message: { role: 'user', content: `turn ${i} ` + 'x'.repeat(size) }, uuid: u, timestamp: new Date(t0 + i * 600_000).toISOString() });
    rows.push({ ...base, parentUuid: u, type: 'assistant', message: { id: `msg_long_${i}`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: `answer ${i}` }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 } }, uuid: a, timestamp: new Date(t0 + i * 600_000 + 20_000).toISOString() });
    parent = a;
  }
  fs.writeFileSync(path.join(dir, `${sid}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

async function main() {
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  await req({ kind: 'settings.set', key: 'network.proxy', value: 'off' });
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const A = await req({ kind: 'providers.upsert', provider: { name: '中转', type: 'anthropic', baseUrl: up, apiKey: 'relay-key-e2e', defaultModel: 'claude-sonnet-4-6', models: ['claude-sonnet-4-6'] } });

  // ---- the permission mode it comes back in ----
  const o = await req({ kind: 'session.open', params: { cwd: proj, providerId: A.id, model: 'claude-sonnet-4-6', permissionMode: 'bypassPermissions' } });
  const sid = o.sessionId;
  for (let i = 0; i < 2; i++) {
    const from = events.length;
    await req({ kind: 'session.send', params: { sessionId: sid, text: `hello ${i}` } });
    const r = await resultOf(sid, from);
    check(`turn ${i + 1} ran`, r?.subtype === 'success', r?.subtype);
    await until(async () => (await req({ kind: 'session.info', sessionId: sid }).catch(() => null))?.info?.state === 'idle', 30_000, 300);
  }
  const meta1 = await req({ kind: 'sessions.meta' });
  check('the mode it runs in is recorded for the conversation', meta1[sid]?.permissionMode === 'bypassPermissions', JSON.stringify(meta1[sid]));
  await req({ kind: 'session.close', sessionId: sid });
  // a window that never had it live (after a restart, the phone, IM) resumes it without a mode
  const back = await req({ kind: 'session.open', params: { sessionId: sid, cwd: proj } });
  check('resumed without a mode: back in 完全放开, not 每步询问', back.info?.permissionMode === 'bypassPermissions', back.info?.permissionMode);
  await req({ kind: 'session.close', sessionId: sid });
  await req({ kind: 'settings.set', key: 'ui.defaultMode', value: 'acceptEdits' });
  const fresh = await req({ kind: 'session.open', params: { cwd: proj, providerId: A.id, model: 'claude-sonnet-4-6' } });
  check('a conversation with nothing recorded gets the default for new conversations', fresh.info?.permissionMode === 'acceptEdits', fresh.info?.permissionMode);
  await req({ kind: 'session.close', sessionId: fresh.sessionId });

  // ---- history: the line under each answer ----
  const page = await req({ kind: 'transcript.load', sessionId: sid, page: true });
  const results1 = (page?.messages ?? []).filter((m) => m.type === 'result');
  check('transcript.load page: { messages }, the whole of a short conversation, no cursor', Array.isArray(page?.messages) && !page.next, JSON.stringify(Object.keys(page ?? {})));
  check('each turn ends with a result made from the record', results1.length === 2 && results1.every((m) => m.cw_history), String(results1.length));
  check('… with what the live line said: time, steps, cost, tokens (the ledger)', results1.every((m) => m.duration_ms > 0 && m.num_turns >= 1 && m.total_cost_usd > 0 && m.usage?.cache_read_input_tokens >= 3000), JSON.stringify(results1[0] ?? null).slice(0, 300));
  const plain = await req({ kind: 'transcript.load', sessionId: sid });
  check('without page: the array, as before', Array.isArray(plain) && plain.filter((m) => m.type === 'result').length === 2);

  // ---- a long conversation, paged ----
  const long = randomUUID();
  writeLong(proj, long, 12, 900_000); // ~11 MB
  await until(async () => (await req({ kind: 'sessions.list' }).catch(() => [])).some?.((s) => s.sessionId === long), 15_000, 500);
  const p1 = await req({ kind: 'transcript.load', sessionId: long, page: true });
  const firstUser = p1?.messages?.find((m) => m.type === 'user');
  check('the newest page of a long one: under the whole, starting at a turn, with a cursor', p1?.next && p1.messages.length < 36 && firstUser && p1.messages[0] === firstUser, `${p1?.messages?.length} msgs, next ${p1?.next}`);
  let all = [...(p1?.messages ?? [])];
  let cursor = p1?.next;
  for (let i = 0; cursor && i < 20; i++) {
    const p = await req({ kind: 'transcript.load', sessionId: long, page: true, cursor });
    all = [...p.messages, ...all];
    cursor = p.next;
  }
  const users = all.filter((m) => m.type === 'user').map((m) => /^turn (\d+)/.exec(m.message.content)?.[1]);
  check('the pages before it, through to the first turn: every turn once, in order', users.join(',') === Array.from({ length: 12 }, (_, i) => String(i)).join(','), users.join(','));
  check('… and a line under every answer (no ledger: no cost)', all.filter((m) => m.type === 'result').length === 12 && all.every((m) => m.type !== 'result' || m.cw_cost_absent), '');

  // ---- custom.css (issue #2) ----
  const c0 = await req({ kind: 'ui.customCss' });
  check('no custom.css yet: said so, with where it would be', c0?.exists === false && c0.path.endsWith('custom.css'), JSON.stringify(c0));
  const made = await req({ kind: 'ui.customCss.create' });
  const c1 = await req({ kind: 'ui.customCss' });
  check('made with the template: what it is for and the hooks', c1?.exists && made.path === c1.path && /data-done/.test(c1.css) && /--progress/.test(c1.css) && /自定义样式/.test(c1.css), c1?.css?.slice(0, 80));
  const from = events.length;
  fs.writeFileSync(c1.path, '.tasks-plan .plan-prog { height: 6px; }\n');
  const told = await until(() => events.slice(from).some((e) => e.kind === 'customCss.changed'), 5000, 100);
  const c2 = await req({ kind: 'ui.customCss' });
  check('saving it tells every window at once, and they read the new text', told && c2.css.includes('height: 6px'), JSON.stringify(c2.css));
  fs.writeFileSync(c1.path, '/* x */'.repeat(80_000));
  const c3 = await req({ kind: 'ui.customCss' });
  check('a file over 512 KB is not loaded, and says why', c3.exists && !c3.css && /512/.test(c3.error ?? ''), c3.error);

  // ---- another Claude account ----
  const tok = 'sk-ant-oat01-' + randomBytes(48).toString('base64url');
  const acct = await req({ kind: 'providers.upsert', provider: { name: '工作号', type: 'claude-account', apiKey: tok, baseUrl: '' } });
  const listed = (await req({ kind: 'providers.list' })).find((p) => p.id === acct.id);
  check('a Claude account: saved with the account\'s models, its token never on the wire', listed?.type === 'claude-account' && listed.models?.includes('claude-opus-5-5') && listed.modelNames?.['claude-opus-5-5'] === 'Opus 5.5' && !String(listed.apiKey).includes(tok.slice(20, 40)), JSON.stringify(listed).slice(0, 200));
  const shape = await req({ kind: 'providers.probe', provider: { type: 'claude-account', apiKey: 'sk-relay-not-a-token' }, listOnly: true });
  check('… a token of another kind is refused before anything is sent', shape?.ok === false && /sk-ant-oat/.test(shape.error ?? ''), shape?.error);
  const refreshed = await req({ kind: 'providers.refreshModels', ids: [acct.id] });
  check('… refreshing its models keeps the account\'s list (nothing pulled)', refreshed?.[0]?.ok === true, JSON.stringify(refreshed));
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
  console.log(`\nphase29: ${results.length - failed}/${results.length} passed`);
  if (failed) console.log(slog.split('\n').slice(-30).join('\n'));
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* windows may still hold a handle */ }
  process.exit(failed ? 1 : 0);
}
