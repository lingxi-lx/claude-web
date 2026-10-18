// Real-machine check of 子代理用任何模型 (2026-10-18): spends a few real tokens. Starts its own server on a copy of the
// user's meta.json (providers' keys are DPAPI-encrypted for this Windows user, so the copy decrypts) in a temp
// CLAUDE_WEB_DIR, with the real HOME (the account login), in a temp project folder that is removed afterwards along
// with its ~/.claude/projects entry. Never writes to ~/.claude-web.
//   node scripts/real-subagent-split.mjs <mainProviderId|claude> <subProviderId|claude> <subModel> [mainModel]
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const [mainId, subId, subModel, mainModel] = process.argv.slice(2);
if (!mainId || !subId || !subModel) { console.error('usage: <main> <sub> <subModel> [mainModel]'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-real-sub-'));
const dataDir = path.join(tmp, 'data');
const proj = path.join(tmp, 'proj');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(proj, { recursive: true });
const meta = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude-web', 'meta.json'), 'utf8'));
fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify({ version: meta.version, providers: meta.providers, settings: { 'network.proxy': meta.settings?.['network.proxy'] ?? 'system', 'ui.disabledModels': meta.settings?.['ui.disabledModels'] } }));

const token = randomBytes(12).toString('hex');
const env = { ...process.env, PORT: '0', CLAUDE_WEB_TOKEN: token, CLAUDE_WEB_DIR: dataDir, CW_NO_MODEL_REFRESH: '1', CW_NO_PUBLIC_BROKERS: '1' };
for (const k of ['CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_WEB_DIST', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION']) delete env[k];
const server = spawn(process.execPath, [path.join(root, 'server', 'dist', 'index.js')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let slog = '';
server.stderr.on('data', (d) => { slog += d; });
const port = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`server did not start\n${slog}`)), 60_000);
  server.stdout.on('data', (d) => { slog += d; const m = /listening on http:\/\/[^:]+:(\d+)/.exec(slog); if (m) { clearTimeout(t); res(m[1]); } });
});
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
let seq = 0;
const pending = new Map();
const events = [];
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type === 'reply') { const p = pending.get(m.reply.id); pending.delete(m.reply.id); m.reply.ok ? p.res(m.reply.data) : p.rej(new Error(m.reply.error)); return; }
  if (m.type === 'event') events.push(m.event);
});
const req = (r) => new Promise((res, rej) => { const id = String(++seq); pending.set(id, { res, rej }); ws.send(JSON.stringify({ type: 'request', request: { id, req: r } })); });
const until = async (fn, ms, step = 500) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, step)); } };

let sid = '';
try {
  const pick = `cw-x:${encodeURIComponent(subId)}:${subModel}`;
  const o = await req({ kind: 'session.open', params: { cwd: proj, providerId: mainId === 'claude' ? undefined : mainId, ...(mainModel ? { model: mainModel } : {}), permissionMode: 'bypassPermissions', subagentModel: pick } });
  sid = o.sessionId;
  console.log('opened', sid, 'runtime', o.info?.runtime, 'main model', o.info?.model, 'sub', o.info?.subagentModel);
  const from = events.length;
  await req({ kind: 'session.send', params: { sessionId: sid, text: 'Use the Agent tool exactly once (subagent_type general-purpose) with the prompt "Reply with exactly: PONG-SUB and say which model you are." Then tell me, in one line, what the subagent answered. Do nothing else.' } });
  const result = await until(() => events.slice(from).find((e) => e.kind === 'session.event' && e.sessionId === sid && e.message?.type === 'result')?.message, 300_000);
  const texts = events.slice(from).filter((e) => e.kind === 'session.event' && e.sessionId === sid && e.message?.type === 'assistant').map((e) => ({ parent: e.message.parent_tool_use_id ?? null, model: e.message.message?.model, text: (e.message.message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').slice(0, 160) })).filter((x) => x.text);
  console.log('result', result?.subtype, result?.is_error ? 'ERROR' : '', JSON.stringify(result?.modelUsage ? Object.keys(result.modelUsage) : null));
  for (const t of texts) console.log(t.parent ? '  [sub]' : '  [main]', t.model, '|', t.text);
  const subs = await req({ kind: 'transcript.subagents', sessionId: sid }).catch(() => []);
  for (const a of subs) {
    const msgs = await req({ kind: 'transcript.subagent', sessionId: sid, agentId: a }).catch(() => []);
    const models = [...new Set(msgs.filter((m) => m.type === 'assistant').map((m) => m.message?.model))];
    console.log('  subagent transcript', a, 'models', JSON.stringify(models), '|', msgs.filter((m) => m.type === 'assistant').flatMap((m) => (m.message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text)).join(' ').slice(0, 160));
  }
  if (!result) console.log(slog.split('\n').slice(-25).join('\n'));
} catch (e) {
  console.log('error', e.message);
  console.log(slog.split('\n').slice(-25).join('\n'));
} finally {
  if (sid) await req({ kind: 'session.close', sessionId: sid }).catch(() => {});
  ws.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 1500));
  fs.rmSync(tmp, { recursive: true, force: true });
  const projects = path.join(os.homedir(), '.claude', 'projects');
  for (const d of fs.existsSync(projects) ? fs.readdirSync(projects) : []) if (d.includes('cw-real-sub-')) fs.rmSync(path.join(projects, d), { recursive: true, force: true });
}
