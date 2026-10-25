// Phase 34 end-to-end (2026-10-25, stage D4): the ```nodegraph hint in the appended system prompt, behind the setting
// ui.nodegraphHint (default on). A real server and the real engine against a fake Anthropic upstream started here (no
// model, no token): the upstream records each streamed request's system prompt.
//   · nothing set: a new conversation's system prompt tells Claude about ```nodegraph (the whole format: okText …);
//   · ui.nodegraphHint off: a new conversation's system prompt has no nodegraph.
//   node server/ws-phase34.mjs   (starts its own server; scripts/e2e.mjs' port/token are ignored)
import WebSocket from 'ws';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-phase34-'));
const home = path.join(root, 'home');
fs.mkdirSync(path.join(home, '.claude'), { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push([name, !!ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const until = async (fn, ms, step = 200) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, step)); } };

// ---- the fake upstream ----
const hits = [];
let n = 0;
const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => typeof p === 'string' ? p : p?.text ?? (typeof p?.content === 'string' ? p.content : Array.isArray(p?.content) ? textOf(p.content) : '')).join('\n') : '';
const json = (s, status, o) => s.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(o));

function sse(s, j, text) {
  const msg = { id: `msg_${++n}`, type: 'message', role: 'assistant', model: j.model, stop_sequence: null };
  const ev = (type, o) => `event: ${type}\ndata: ${JSON.stringify({ type, ...o })}\n\n`;
  let out = ev('message_start', { message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  out += ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
  out += ev('content_block_stop', { index: 0 }) + ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } }) + ev('message_stop', {});
  s.writeHead(200, { 'content-type': 'text/event-stream' });
  s.end(out);
}

const upstream = http.createServer((q, s) => {
  let raw = '';
  q.on('data', (c) => { raw += c; });
  q.on('end', () => {
    let j = {};
    try { j = JSON.parse(raw || '{}'); } catch { /* keep */ }
    const url = q.url ?? '';
    if (url.includes('/count_tokens')) return json(s, 200, { input_tokens: 10 });
    if (!url.startsWith('/v1/messages')) return json(s, 404, { error: { type: 'not_found_error', message: 'no' } });
    hits.push({ stream: !!j.stream, sys: textOf(j.system) });
    const msg = { id: `msg_${++n}`, type: 'message', role: 'assistant', model: j.model, stop_sequence: null };
    if (!j.stream) return json(s, 200, { ...msg, content: [{ type: 'text', text: 'side:ok' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 } });
    return sse(s, j, 'main:ok');
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const up = `http://127.0.0.1:${upstream.address().port}`;

// ---- the server: throwaway HOME, no proxy ----
const token = randomBytes(12).toString('hex');
const env = { ...process.env, HOME: home, USERPROFILE: home, PORT: '0', CLAUDE_WEB_TOKEN: token, CLAUDE_WEB_DIR: path.join(home, '.claude-web'), CW_NO_MODEL_REFRESH: '1', CW_NO_PUBLIC_BROKERS: '1', CLAUDE_WEB_SYSTEM_LANG: 'zh-CN' };
for (const k of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR|CLAUDE_WEB_CONTEXT_WINDOWS|CLAUDE_WEB_MODEL_CAPS|OPENAI_|GEMINI_|GROK_|XAI_)/.test(k) || /^(no_proxy|https?_proxy|all_proxy)$/i.test(k)) delete env[k];
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
const resultOf = (sid, from, ms = 120_000) => until(() => events.slice(from).find((e) => e.kind === 'session.event' && e.sessionId === sid && e.message?.type === 'result')?.message, ms);

/** A new conversation, one turn; what the streamed (main) requests carried as their system prompt. */
async function turn(proj, text) {
  const o = await req({ kind: 'session.open', params: { cwd: proj, model: 'claude-opus-5-5', permissionMode: 'bypassPermissions', features: { env: { ANTHROPIC_BASE_URL: up, ANTHROPIC_AUTH_TOKEN: 'phase34-e2e' } } } });
  const mark = hits.length;
  const from = events.length;
  await req({ kind: 'session.send', params: { sessionId: o.sessionId, text } });
  const r = await resultOf(o.sessionId, from);
  await req({ kind: 'session.close', sessionId: o.sessionId }).catch(() => {});
  return { result: r?.subtype, sys: hits.slice(mark).filter((h) => h.stream).map((h) => h.sys).join('\n') };
}

async function main() {
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  await req({ kind: 'settings.set', key: 'network.proxy', value: 'off' });
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj, { recursive: true });

  const on = await turn(proj, 'hello');
  check('default: the appended system prompt tells Claude about ```nodegraph', on.result === 'success' && /```nodegraph/.test(on.sys) && /okText/.test(on.sys), `${on.result} ${on.sys.length} chars`);
  await req({ kind: 'settings.set', key: 'ui.nodegraphHint', value: false });
  const off = await turn(proj, 'hello again');
  check('ui.nodegraphHint off: a new conversation has no nodegraph hint', off.result === 'success' && off.sys.length > 0 && !/nodegraph/.test(off.sys), `${off.result} ${off.sys.length} chars`);
  await req({ kind: 'settings.set', key: 'ui.nodegraphHint', value: true });
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
  console.log(`\nphase34: ${results.length - failed}/${results.length} passed`);
  if (failed) console.log(slog.split('\n').slice(-30).join('\n'));
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* windows may still hold a handle */ }
  process.exit(failed ? 1 : 0);
}
