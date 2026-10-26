// Phase 40 end-to-end (2026-10-26): ego lite as the browser Claude acts in first — a real server and the real engines
// (ours, then the official binary) against a fake Anthropic upstream, with a fake `ego-browser` on PATH. Per engine:
//   · web.status finds ego lite (and its version); a conversation's tools include ego_browser, and the built-in
//     browser's tools say to prefer it;
//   · the model calls ego_browser with a script in Chinese, quotes and backticks: the permission card carries the script,
//     ego-browser gets `nodejs -e "await import('file:///…/round-01.mjs')"` and that file holds the script byte for byte
//     after the CW_SPACE / CW_OUT lines; the output and the screenshot the script saved reach the model;
//   · 「内置浏览器」 in settings: a new conversation has no ego tools.
//   node server/ws-phase40.mjs   (starts its own server; scripts/e2e.mjs' port/token are ignored)
import WebSocket from 'ws';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-phase40-'));
const home = path.join(root, 'home');
const dataDir = path.join(home, '.claude-web');
fs.mkdirSync(home, { recursive: true });

const results = [];
const checkRaw = (name, ok, detail = '') => { results.push([name, !!ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const until = async (fn, ms, step = 200) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, step)); } };

// ---- a fake ego-browser on PATH ----
const bin = path.join(root, 'bin');
fs.mkdirSync(bin);
const egoLog = path.join(root, 'ego-calls.log');
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
const [cmd, flag, code] = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(egoLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
if (cmd === 'skill') { process.stdout.write('[ego-browser:skill] ego-browser v9.8.7\\n# Fake guide\\nconst task = await taskSpace(name)\\n'); process.exit(0); }
if (cmd !== 'nodejs' || flag !== '-e') { process.stderr.write('usage'); process.exit(2); }
globalThis.taskSpace = async (n) => ({ name: n, page: () => ({ goto: async () => {} }) });
(async () => { await eval('(async () => {' + code + '})()'); })().catch((e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });
`;
fs.writeFileSync(path.join(bin, 'ego-browser.js'), FAKE);
if (process.platform === 'win32') fs.writeFileSync(path.join(bin, 'ego-browser.cmd'), '@ECHO off\r\nnode "%~dp0\\ego-browser.js" %*\r\n');
else { fs.writeFileSync(path.join(bin, 'ego-browser'), FAKE); fs.chmodSync(path.join(bin, 'ego-browser'), 0o755); }

const SCRIPT = 'const t = await taskSpace(CW_SPACE);\nawait t.page("p1").goto("https://example.com/登录");\nconsole.log(`中文-OK:${t.name} "引号" \'单引号\' $HOME %PATH%`);\nconst fs = await import("node:fs");\nconst path = await import("node:path");\nfs.writeFileSync(path.join(CW_OUT, "shot.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));';

// ---- the fake upstream ----
const hits = [];
let n = 0;
const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => typeof p === 'string' ? p : p?.text ?? (typeof p?.content === 'string' ? p.content : Array.isArray(p?.content) ? textOf(p.content) : '')).join('\n') : '';
const lastToolResult = (j) => {
  const last = (j.messages ?? []).at(-1);
  if (last?.role !== 'user' || !Array.isArray(last.content)) return null;
  return last.content.find((b) => b?.type === 'tool_result') ?? null;
};
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

let call = 0;
function anthropic(s, j, h, raw) {
  if (h.url.includes('/count_tokens')) return json(s, 200, { input_tokens: 10 });
  if (!j.stream) return json(s, 200, { id: `msg_${++n}`, type: 'message', role: 'assistant', model: j.model, content: [{ type: 'text', text: 'side:ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } });
  h.main = true;
  h.tools = (j.tools ?? []).map((t) => t.name);
  h.mentionsEgo = raw.includes('mcp__web__ego_browser');
  h.openDesc = (j.tools ?? []).find((t) => t.name === 'mcp__web__browser_open')?.description ?? '';
  const tr = lastToolResult(j);
  const ego = (id) => {
    // the tool directly, or through the engine's deferred-tool runner
    const direct = h.tools.includes('mcp__web__ego_browser');
    h.called = direct ? 'direct' : 'extra';
    return sse(s, j, [direct ? { type: 'tool_use', id, name: 'mcp__web__ego_browser', input: { script: SCRIPT } } : { type: 'tool_use', id, name: 'ExecuteExtraTool', input: { tool_name: 'mcp__web__ego_browser', params: { script: SCRIPT } } }], 'tool_use');
  };
  // our engine runs a deferred tool only after SearchExtraTools found it, the way a model first looks it up
  if (tr && String(tr.tool_use_id).startsWith('toolu_search_')) return ego(`toolu_ego_${++call}`);
  if (tr) { h.toolResult = tr; return sse(s, j, [{ type: 'text', text: 'main: done' }], 'end_turn'); }
  if (/EGO-GO/.test(turnText(j))) {
    if (!h.tools.includes('mcp__web__ego_browser') && h.tools.includes('SearchExtraTools')) return sse(s, j, [{ type: 'tool_use', id: `toolu_search_${++call}`, name: 'SearchExtraTools', input: { query: 'select:mcp__web__ego_browser', max_results: 3 } }], 'tool_use');
    return ego(`toolu_ego_${++call}`);
  }
  return sse(s, j, [{ type: 'text', text: 'main:ok' }], 'end_turn');
}
const upstream = http.createServer((q, s) => {
  let raw = '';
  q.on('data', (c) => { raw += c; });
  q.on('end', () => {
    let j = {};
    try { j = JSON.parse(raw || '{}'); } catch { /* keep */ }
    const h = { url: q.url ?? '', model: j.model };
    hits.push(h);
    if (h.url.startsWith('/v1/messages')) return anthropic(s, j, h, raw);
    if (h.url.includes('/models')) return json(s, 200, { data: [{ id: 'claude-sonnet-4-6', type: 'model' }] });
    json(s, 404, { error: { message: 'no' } });
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const up = `http://127.0.0.1:${upstream.address().port}`;

// ---- the server: throwaway HOME, the fake ego-browser first on PATH ----
const token = randomBytes(12).toString('hex');
const env = { ...process.env, HOME: home, USERPROFILE: home, PORT: '0', CLAUDE_WEB_TOKEN: token, CLAUDE_WEB_DIR: dataDir, CW_NO_MODEL_REFRESH: '1', CW_NO_PUBLIC_BROKERS: '1', PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` };
for (const k of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR|OPENAI_)/.test(k) || /^(no_proxy|https?_proxy|all_proxy)$/i.test(k)) delete env[k];
if (process.platform === 'win32') delete env.Path;
const server = spawn(process.execPath, [path.join(here, 'dist', 'index.js')], { cwd: path.dirname(here), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
const resultOf = (sid, from, ms = 180_000) => until(() => msgsOf(sid, from).find((m) => m.type === 'result'), ms);

async function main() {
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  await req({ kind: 'settings.set', key: 'network.proxy', value: 'off' });
  const st = await until(async () => { const s = await req({ kind: 'web.status' }); return s.ego?.found ? s : null; }, 30_000, 500);
  checkRaw('web.status finds ego lite on PATH, with the version its guide states; the choice is 自动', st?.ego?.version === '9.8.7' && st.agentBrowser === 'auto', JSON.stringify(st && { ego: st.ego, agentBrowser: st.agentBrowser }));
  for (const runtime of (process.env.PHASE40_RUNTIMES ?? 'ccb,claude').split(',')) await suite(runtime);
}

async function suite(runtime) {
  const tag = runtime === 'ccb' ? '[engine]' : '[official]';
  const check = (name, ok, detail) => checkRaw(`${tag} ${name}`, ok, detail);
  const proj = path.join(root, `proj-${runtime}`);
  fs.mkdirSync(proj, { recursive: true });
  await req({ kind: 'settings.set', key: 'web.browser.agent', value: null });
  const A = await req({ kind: 'providers.upsert', provider: { name: `中转${runtime}`, type: 'anthropic', baseUrl: up, apiKey: 'relay-key-e2e', defaultModel: 'claude-sonnet-4-6', models: ['claude-sonnet-4-6'], ...(runtime === 'claude' ? { runtime: 'claude' } : {}) } });

  // ---- ego lite found: its tools are there and Claude can run a script ----
  const o = await req({ kind: 'session.open', params: { cwd: proj, providerId: A.id, model: 'claude-sonnet-4-6', permissionMode: 'default' } });
  const sid = o.sessionId;
  const mark = hits.length;
  const from = events.length;
  fs.writeFileSync(egoLog, '');
  await req({ kind: 'session.send', params: { sessionId: sid, text: 'EGO-GO open the page' } });
  // allow anything else that asks on the way (looking the tool up); keep the ego_browser card
  const isEgo = (rq) => /ego_browser/.test(String(rq.toolName) + String(rq.input?.tool_name ?? ''));
  const asked = await until(() => {
    for (const e of events.slice(from)) {
      if (e.kind !== 'permission.request' || e.request.sessionId !== sid) continue;
      if (isEgo(e.request)) return e.request;
      if (!e.request.__allowed) { e.request.__allowed = true; void req({ kind: 'permission.respond', requestId: e.request.requestId, response: { behavior: 'allow' } }).catch(() => {}); }
    }
    return null;
  }, 120_000, 300);
  const askedScript = asked?.input?.script ?? asked?.input?.params?.script;
  check('ego_browser is asked about, and the card carries the script', !!asked && /ego_browser/.test(JSON.stringify(asked.toolName) + JSON.stringify(asked.input?.tool_name ?? '')) && askedScript === SCRIPT, JSON.stringify(asked && { toolName: asked.toolName, input: asked.input }).slice(0, 400));
  if (asked) await req({ kind: 'permission.respond', requestId: asked.requestId, response: { behavior: 'allow' } });
  const r = await resultOf(sid, from);
  const mine = hits.slice(mark).filter((h) => h.main);
  const first = mine[0];
  check('the conversation has ego_browser in its tool list itself (not deferred behind ExecuteExtraTool, which would turn the picture into text)', !!first?.tools?.includes('mcp__web__ego_browser') && mine.find((h) => h.called)?.called === 'direct', JSON.stringify({ called: mine.find((h) => h.called)?.called, tools: first?.tools?.filter((t) => /web__|Extra/.test(t)) }));
  if (first?.openDesc) check('… and the built-in browser\'s tools say to prefer it', /use it instead for web tasks/.test(first.openDesc), first.openDesc.slice(-200));
  const calls = fs.readFileSync(egoLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a[0] === 'nodejs');
  check('ego-browser is run once with nodejs -e "await import(file:///…round-01.mjs)" — no script on the command line', calls.length === 1 && calls[0][1] === '-e' && /^await import\("file:\/\/\/.*round-01\.mjs"\)$/.test(calls[0][2] ?? ''), JSON.stringify(calls));
  const round = path.join(dataDir, 'runtime', 'ego', sid.replace(/[^\w-]/g, '').slice(0, 8), 'round-01.mjs');
  const written = fs.existsSync(round) ? fs.readFileSync(round, 'utf8') : '';
  check('… the round file holds the script byte for byte after the CW_SPACE / CW_OUT lines', written.endsWith(`\n${SCRIPT}`) && written.startsWith(`globalThis.CW_SPACE = "claude-web ${sid.slice(0, 8)}";`), written.slice(0, 160));
  const tr = mine.find((h) => h.toolResult)?.toolResult;
  const trText = textOf(tr?.content);
  check('the output reaches the model: Chinese, quotes and $ / % untouched, in this conversation\'s Space', trText.includes(`中文-OK:claude-web ${sid.slice(0, 8)} "引号" '单引号' $HOME %PATH%`) && !tr?.is_error, trText.slice(0, 400));
  check('… with the screenshot the script saved', Array.isArray(tr?.content) && tr.content.some((b) => b?.type === 'image'), JSON.stringify((tr?.content ?? []).map?.((b) => b?.type)));
  check('… and the turn ends normally', r?.subtype === 'success', r?.subtype);
  await req({ kind: 'session.close', sessionId: sid }).catch(() => {});

  // ---- 内置浏览器 picked: a new conversation has no ego tools ----
  await req({ kind: 'settings.set', key: 'web.browser.agent', value: 'builtin' });
  check('web.status says 内置浏览器', (await req({ kind: 'web.status' })).agentBrowser === 'builtin', '');
  const o2 = await req({ kind: 'session.open', params: { cwd: proj, providerId: A.id, model: 'claude-sonnet-4-6', permissionMode: 'default' } });
  const mark2 = hits.length;
  const from2 = events.length;
  await req({ kind: 'session.send', params: { sessionId: o2.sessionId, text: 'hello' } });
  await resultOf(o2.sessionId, from2);
  const h2 = hits.slice(mark2).find((h) => h.main);
  check('… then a new conversation has no ego tools (the built-in browser\'s are still there)', !!h2 && !h2.mentionsEgo && (h2.tools.includes('mcp__web__browser_open') || /ExecuteExtraTool/.test(h2.tools.join())), JSON.stringify(h2?.tools?.filter((t) => /web__/.test(t))));
  await req({ kind: 'session.close', sessionId: o2.sessionId }).catch(() => {});
  await req({ kind: 'settings.set', key: 'web.browser.agent', value: null });
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
  console.log(`\nphase40: ${results.length - failed}/${results.length} passed`);
  if (failed) console.log(slog.split('\n').slice(-30).join('\n'));
  process.exit(failed ? 1 : 0);
}
