// Phase 28 end-to-end (2026-10-14): the 子代理 chip — the model a conversation's subagents run on, over a real server
// and the real engines (ours, then the official binary) against a fake Anthropic upstream started here (no model, no
// token). Per engine:
//   · a conversation opened with a subagent model: the main turn goes out with the main model, the subagent's
//     request with the picked one; the session info says it and meta.json remembers it for the conversation;
//   · back to 「跟主模型一样」 (a restart of the process, invisible): the next subagent runs on the main model;
//   · the old per-provider default (`subagentModels`) and the one default for new conversations (`subagentModel`);
//   · another provider's model (2026-10-18, any model whatever the conversation runs on): the main requests keep the
//     conversation's own key, the subagent's go out with the other provider's key and the real model id;
//   · the account through a relay set up in the user's own ~/.claude/settings.json env (2026-10-19): the main requests
//     reach that relay with the user's token, the subagent's the other provider with its key.
//   node server/ws-phase28.mjs   (starts its own server; scripts/e2e.mjs' port/token are ignored)
import WebSocket from 'ws';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-phase28-'));
const home = path.join(root, 'home');
fs.mkdirSync(home, { recursive: true });

const results = [];
const checkRaw = (name, ok, detail = '') => { results.push([name, !!ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const until = async (fn, ms, step = 200) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, step)); } };

// ---- the fake upstream ----
const hits = [];
let n = 0;
const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => typeof p === 'string' ? p : p?.text ?? (typeof p?.content === 'string' ? p.content : Array.isArray(p?.content) ? textOf(p.content) : '')).join('\n') : '';
const lastToolResult = (j) => {
  const last = (j.messages ?? []).at(-1);
  if (last?.role !== 'user' || !Array.isArray(last.content)) return null;
  return last.content.find((b) => b?.type === 'tool_result') ?? null;
};
const firstUser = (j) => textOf((j.messages ?? []).find((m) => m.role === 'user')?.content);
const turnText = (j) => {
  const msgs = j.messages ?? [];
  let i = msgs.length;
  while (i > 0 && msgs[i - 1].role !== 'assistant') i--;
  return msgs.slice(i).filter((m) => m.role === 'user').map((m) => textOf(m.content)).join('\n');
};
const json = (s, status, o) => s.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(o));

function sse(s, j, blocks, stop) {
  const msg = { id: `msg_${++n}`, type: 'message', role: 'assistant', model: j.model, stop_sequence: null };
  const ev = (type, o) => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
  let out = ev('message_start', { message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  blocks.forEach((b, i) => {
    if (b.type === 'text') out += ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } }) + ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: b.text } });
    else out += ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }) + ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    out += ev('content_block_stop', { index: i });
  });
  out += ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 3 } }) + ev('message_stop', {});
  s.writeHead(200, { 'content-type': 'text/event-stream' });
  s.end(out);
}

let agentRun = 0;
function anthropic(q, s, j, h) {
  if (q.url.includes('/count_tokens')) return json(s, 200, { input_tokens: 10 });
  const msg = { id: `msg_${++n}`, type: 'message', role: 'assistant', model: j.model, stop_sequence: null };
  if (!j.stream) return json(s, 200, { ...msg, content: [{ type: 'text', text: 'side:ok' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 } });
  // the subagent: its first (and only) user message is the prompt the main turn gave it
  if (/SUBAGENT-PROMPT/.test(firstUser(j)) && !/RUN-AGENT/.test(firstUser(j))) {
    h.role = 'sub';
    return sse(s, j, [{ type: 'text', text: 'sub:ok' }], 'end_turn');
  }
  h.role = 'main';
  const tr = lastToolResult(j);
  if (tr) return sse(s, j, [{ type: 'text', text: `main: after ${tr.tool_use_id}` }], 'end_turn');
  if (/RUN-AGENT/.test(turnText(j))) {
    const tool = (j.tools ?? []).map((t) => t.name).find((x) => x === 'Agent' || x === 'Task') ?? 'Agent';
    h.agentTool = tool;
    return sse(s, j, [{ type: 'tool_use', id: `toolu_agent_${++agentRun}`, name: tool, input: { description: 'e2e subagent', prompt: 'SUBAGENT-PROMPT: answer sub:ok', subagent_type: 'general-purpose' } }], 'tool_use');
  }
  return sse(s, j, [{ type: 'text', text: 'main:ok' }], 'end_turn');
}

const upstream = http.createServer((q, s) => {
  let raw = '';
  q.on('data', (c) => { raw += c; });
  q.on('end', () => {
    let j = {};
    try { j = JSON.parse(raw || '{}'); } catch { /* keep */ }
    // `/relayA/…`: the relay the user set up in their own ~/.claude/settings.json (the account-through-a-relay round)
    const relayA = (q.url ?? '').startsWith('/relayA/');
    const h = { method: q.method, url: relayA ? q.url.slice('/relayA'.length) : q.url ?? '', relayA, model: j.model, at: Date.now(), auth: String(q.headers.authorization ?? q.headers['x-api-key'] ?? '') };
    hits.push(h);
    if (h.url.startsWith('/v1/messages')) return anthropic(q, s, j, h);
    if (h.url.includes('/models')) return json(s, 200, { data: [{ id: 'claude-sonnet-4-6', type: 'model' }, { id: 'small-model', type: 'model' }] });
    json(s, 404, { error: { message: 'no' } });
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const up = `http://127.0.0.1:${upstream.address().port}`;

// ---- the server: throwaway HOME, no proxy ----
const token = randomBytes(12).toString('hex');
const env = { ...process.env, HOME: home, USERPROFILE: home, PORT: '0', CLAUDE_WEB_TOKEN: token, CLAUDE_WEB_DIR: path.join(home, '.claude-web'), CW_NO_MODEL_REFRESH: '1', CW_NO_PUBLIC_BROKERS: '1' };
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
const msgsOf = (sid, from) => events.slice(from).filter((e) => e.kind === 'session.event' && e.sessionId === sid).map((e) => e.message);
const resultOf = (sid, from, ms = 120_000) => until(() => msgsOf(sid, from).find((m) => m.type === 'result'), ms);

/** One turn that sends a subagent off: the models of the main and the subagent requests it made. */
async function agentTurn(sid) {
  const mark = hits.length;
  const from = events.length;
  await req({ kind: 'session.send', params: { sessionId: sid, text: 'RUN-AGENT please' } });
  // an engine that asks before the subagent goes: allow it
  const asked = until(() => events.slice(from).find((e) => e.kind === 'permission.request' && e.request.sessionId === sid)?.request, 120_000, 300);
  void asked.then((a) => a && req({ kind: 'permission.respond', requestId: a.requestId, response: { behavior: 'allow' } }));
  const r = await resultOf(sid, from);
  const mine = hits.slice(mark);
  const m = mine.find((h) => h.role === 'main'), sb = mine.find((h) => h.role === 'sub');
  return { result: r?.subtype, main: m?.model, sub: sb?.model, mainAuth: m?.auth, subAuth: sb?.auth, mainRelayA: m?.relayA, subRelayA: sb?.relayA, tool: mine.find((h) => h.agentTool)?.agentTool };
}

async function main() {
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  await req({ kind: 'settings.set', key: 'network.proxy', value: 'off' });
  for (const runtime of (process.env.PHASE28_RUNTIMES ?? 'ccb,claude').split(',')) await suite(runtime);
}

async function suite(runtime) {
  const tag = runtime === 'ccb' ? '[engine]' : '[official]';
  const check = (name, ok, detail) => checkRaw(`${tag} ${name}`, ok, detail);
  hits.length = 0;
  const proj = path.join(root, `proj-${runtime}`);
  fs.mkdirSync(proj, { recursive: true });
  // small-model: 120K, so neither engine gives it a [1m]
  const A = await req({ kind: 'providers.upsert', provider: { name: `中转${runtime}`, type: 'anthropic', baseUrl: up, apiKey: 'relay-key-e2e', defaultModel: 'claude-sonnet-4-6', models: ['claude-sonnet-4-6', 'small-model'], contextWindows: { 'small-model': 120_000 }, ...(runtime === 'claude' ? { runtime: 'claude' } : {}) } });

  // ---- opened with a pick ----
  const full = (pid, m) => `cw-x:${encodeURIComponent(pid)}:${m}`;
  const o = await req({ kind: 'session.open', params: { cwd: proj, providerId: A.id, model: 'claude-sonnet-4-6', permissionMode: 'default', subagentModel: 'small-model' } });
  const sid = o.sessionId;
  check('the session info says the subagents model (a whole pick: provider + model)', o.info?.subagentModel === full(A.id, 'small-model'), JSON.stringify(o.info?.subagentModel));
  const t1 = await agentTurn(sid);
  check('the main turn goes out with the main model', /^claude-sonnet-4-6/.test(t1.main ?? ''), JSON.stringify(t1));
  check('… the subagent with the picked one', t1.sub === 'small-model', JSON.stringify(t1));
  const meta = await req({ kind: 'sessions.meta' });
  check('… remembered for the conversation', meta[sid]?.subagent?.model === full(A.id, 'small-model'), JSON.stringify(meta[sid]));

  // ---- back to the main model ----
  const from = events.length;
  await req({ kind: 'session.setSubagentModel', sessionId: sid, model: '', providerId: A.id });
  const info = await until(() => events.slice(from).find((e) => e.kind === 'session.info' && e.info?.sessionId === sid && e.info.subagentModel === undefined)?.info, 10_000);
  check('跟主模型一样: the info says so', !!info, '');
  await until(async () => (await req({ kind: 'session.info', sessionId: sid }).catch(() => null))?.info?.state === 'idle', 60_000, 500);
  const t2 = await agentTurn(sid);
  check('… and the next subagent runs on the main model (the process restarted, the conversation went on)', /^claude-sonnet-4-6/.test(t2.sub ?? '') && t2.result === 'success', JSON.stringify(t2));
  await req({ kind: 'session.close', sessionId: sid }).catch(() => {});

  // ---- the provider's default for new conversations ----
  await req({ kind: 'settings.set', key: 'subagentModels', value: { [A.id]: 'small-model' } });
  const o2 = await req({ kind: 'session.open', params: { cwd: proj, providerId: A.id, model: 'claude-sonnet-4-6', permissionMode: 'default' } });
  check('a new conversation without a pick gets the old provider default', o2.info?.subagentModel === full(A.id, 'small-model'), JSON.stringify(o2.info?.subagentModel));
  const t3 = await agentTurn(o2.sessionId);
  check('… and its subagent runs on it', t3.sub === 'small-model', JSON.stringify(t3));
  await req({ kind: 'session.close', sessionId: o2.sessionId }).catch(() => {});
  await req({ kind: 'settings.set', key: 'subagentModels', value: {} });

  // ---- another provider's model for the subagents ----
  const B = await req({ kind: 'providers.upsert', provider: { name: `另一家${runtime}`, type: 'anthropic', baseUrl: up, apiKey: 'other-key-e2e', defaultModel: 'small-model', models: ['small-model'] } });
  await req({ kind: 'settings.set', key: 'subagentModel', value: full(B.id, 'small-model') });
  const o3 = await req({ kind: 'session.open', params: { cwd: proj, providerId: A.id, model: 'claude-sonnet-4-6', permissionMode: 'default' } });
  check('the one default for new conversations: another provider’s model', o3.info?.subagentModel === full(B.id, 'small-model'), JSON.stringify(o3.info?.subagentModel));
  const t4 = await agentTurn(o3.sessionId);
  check('… the main requests go out with the conversation’s own key', /^claude-sonnet-4-6/.test(t4.main ?? '') && /relay-key-e2e/.test(t4.mainAuth ?? ''), JSON.stringify(t4));
  check('… the subagent’s with the other provider’s key and the real model id', t4.sub === 'small-model' && /other-key-e2e/.test(t4.subAuth ?? '') && t4.result === 'success', JSON.stringify(t4));
  await req({ kind: 'session.close', sessionId: o3.sessionId }).catch(() => {});
  await req({ kind: 'settings.set', key: 'subagentModel', value: null });

  // ---- the account through a relay of the user's own (~/.claude/settings.json env), another provider's model for
  // the subagents (2026-10-19 user report: the pick was ignored, the subagents ran on what the relay maps haiku to).
  // Such a conversation runs on the official binary unless it has a flag only ours knows (session-runner plan()):
  // the engine round gets one (development channels: a flag, nothing more for a conversation without channels).
  const settingsFile = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ env: { ANTHROPIC_BASE_URL: `${up}/relayA`, ANTHROPIC_AUTH_TOKEN: 'user-relay-token-e2e', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-6' } }));
  try {
    const o4 = await req({ kind: 'session.open', params: { cwd: proj, model: 'claude-sonnet-4-6', permissionMode: 'default', subagentModel: full(B.id, 'small-model'), ...(runtime === 'ccb' ? { features: { devChannels: true } } : {}) } });
    check('the account through the user’s relay: runs on this engine, no provider', !o4.info?.providerId && o4.info?.runtime === runtime, JSON.stringify({ p: o4.info?.providerId, rt: o4.info?.runtime }));
    const t5 = await agentTurn(o4.sessionId);
    check('… the main requests reach the user’s relay with the user’s own token', t5.mainRelayA === true && /user-relay-token-e2e/.test(t5.mainAuth ?? '') && /^claude-sonnet-4-6/.test(t5.main ?? ''), JSON.stringify(t5));
    check('… the subagent’s reach the picked provider with its key and the real model id', t5.subRelayA === false && t5.sub === 'small-model' && /other-key-e2e/.test(t5.subAuth ?? '') && t5.result === 'success', JSON.stringify(t5));
    const flags = path.join(home, '.claude-web', 'runtime', 'flag-settings');
    const leaked = fs.existsSync(flags) && fs.readdirSync(flags).some((f) => fs.readFileSync(path.join(flags, f), 'utf8').includes('user-relay-token-e2e'));
    check('… the user’s token is not copied into our --settings file', !leaked, '');
    await req({ kind: 'session.close', sessionId: o4.sessionId }).catch(() => {});
  } finally {
    fs.rmSync(settingsFile, { force: true });
  }
}

try {
  await main();
} catch (e) {
  checkRaw('ran without throwing', false, e?.stack ?? String(e));
} finally {
  ws.close();
  server.kill();
  upstream.close();
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\nphase28: ${results.length - failed}/${results.length} passed`);
  if (failed) console.log(slog.split('\n').slice(-30).join('\n'));
  process.exit(failed ? 1 : 0);
}
