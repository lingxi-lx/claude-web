// Phase 39 end-to-end (stage F2 F3 F4): 导入 claude.ai 数据 + 项目页 + 派活.
// The fixture export (server/fixtures/claude-ai-export) zipped → POST /api/import/claude-ai (token needed) →
// claudeai.scan / claudeai.import into a temp folder → the claude.ai source in sessions.list / library.read, the
// project with its instructions and its document; again → deduped, the user's edit kept. Then the project page:
// instructions / scope / permission mode stored, project files uploaded / listed / removed. Then 派活 into the project:
// a new conversation marked origin 'dispatch', with the project's permission mode, and 上次的 pick remembered.
//   node server/ws-phase39.mjs [port] [token]
import WebSocket from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const port = args[0] ?? '3090';
const token = args[1];
const here = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const check = (name, ok, detail = '') => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000, step = 300) => { const t = Date.now(); for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - t > ms) return null; await sleep(step); } };
const base = `http://127.0.0.1:${port}`;
const tq = token ? `token=${encodeURIComponent(token)}` : '';
const post = (p, body, withToken = true) => fetch(`${base}${p}${withToken && tq ? `${p.includes('?') ? '&' : '?'}${tq}` : ''}`, { method: 'POST', body });

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${token ? `?token=${token}` : ''}`);
let seq = 0;
const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.type === 'reply') { const p = pending.get(m.reply.id); pending.delete(m.reply.id); m.reply.ok ? p.res(m.reply.data) : p.rej(new Error(m.reply.error)); } });
const req = (r) => new Promise((res, rej) => { const id = String(++seq); pending.set(id, { res, rej }); ws.send(JSON.stringify({ type: 'request', request: { id, req: r } })); });
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-e2e-f39-'));
const { makeZip } = await import(pathToFileURL(path.join(here, 'dist', 'import', 'zip.js')).href);
const FIX = path.join(here, 'fixtures', 'claude-ai-export');
const zip = () => makeZip(Object.fromEntries(['conversations.json', 'projects.json', 'users.json'].map((n) => [`data-2026-10-01/${n}`, fs.readFileSync(path.join(FIX, n))])), { deflate: true });
const opened = [];
try {
  // ---- 导入 claude.ai 数据 ----
  const noTok = await post('/api/import/claude-ai', zip(), false);
  check('the upload endpoint needs the app token', noTok.status === 403, String(noTok.status));
  const up = await (await post('/api/import/claude-ai', zip())).json();
  check('upload: the zip is stored for the import', typeof up.path === 'string' && up.path.endsWith('.zip'), up.path);
  const scan = await req({ kind: 'claudeai.scan', path: up.path });
  check('claudeai.scan: conversations / projects / docs / skipped / user', scan.conversations === 3 && scan.projects === 1 && scan.docs === 1 && scan.skipped === 2 && scan.add === 3 && scan.user === 'Ada Example', JSON.stringify(scan));
  const outside = await req({ kind: 'claudeai.scan', path: path.join(tmp, 'x.zip') }).then(() => null, (e) => e.message);
  check('claudeai.scan: only a file the upload wrote', !!outside, outside ?? '');
  const folder = path.join(tmp, 'claude-projects'); fs.mkdirSync(folder);
  const r = await req({ kind: 'claudeai.import', path: up.path, folder });
  check('claudeai.import: 3 conversations, 1 project, 1 file', r.add === 3 && r.projectsCreated === 1 && r.filesWritten === 1, JSON.stringify(r));
  const garden = path.join(folder, 'Garden');
  check("the project's document is in the folder you picked", fs.readFileSync(path.join(garden, 'soil.md'), 'utf8') === '# Soil\nLoam.');
  const wsList = await req({ kind: 'workspaces.list' }).catch(async () => (await req({ kind: 'sessions.projects' })));
  const proj = (Array.isArray(wsList) ? wsList : []).find((w) => path.resolve(w.path ?? '').toLowerCase() === path.resolve(garden).toLowerCase());
  check('the claude.ai project is a project here, with its instructions', !!proj && proj.instructions === 'Answer like a gardener.', JSON.stringify(proj ?? null));
  const sources = await req({ kind: 'library.sources' });
  const src = (Array.isArray(sources) ? sources : sources.sources ?? []).find((s) => s.kind === 'claudeai');
  check('the claude.ai library source is joined', !!src && src.joined === true, JSON.stringify(src ?? null));
  const row = await until(async () => (await req({ kind: 'sessions.list' })).find((s) => s.sessionId === 'claudeai-5f1c2a9e-1111-4a2b-9c3d-000000000001') ?? null);
  check('an imported conversation is in the list, read-only, 接着聊 in Claude', !!row && row.title === 'Plan a garden' && row.caps?.continueInClaude === true && row.caps?.rename === false, JSON.stringify(row?.caps ?? null));
  const hist = await req({ kind: 'library.read', sessionId: 'claudeai-5f1c2a9e-1111-4a2b-9c3d-000000000001', limit: 50 });
  check("library.read: the conversation's messages, attachments included", JSON.stringify(hist).includes('Help me plan my beds') && JSON.stringify(hist).includes('bed 1: tomatoes'));
  const found = await until(async () => { const s = await req({ kind: 'sessions.search', query: 'tomatoes' }); const l = Array.isArray(s) ? s : s.items ?? s.results ?? []; return l.some((x) => String(x.session?.sessionId ?? x.sessionId).startsWith('claudeai-')) ? l : null; }, 30000, 1000);
  check('imported conversations are searchable', !!found);
  fs.writeFileSync(path.join(garden, 'soil.md'), 'my own edits');
  const up2 = await (await post('/api/import/claude-ai', zip())).json();
  const r2 = await req({ kind: 'claudeai.import', path: up2.path, folder });
  check('re-import: deduped by uuid, the project updated, the edited file kept', r2.add === 0 && r2.same === 3 && r2.projectsCreated === 0 && r2.projectsUpdated === 1 && r2.filesKept === 1 && fs.readFileSync(path.join(garden, 'soil.md'), 'utf8') === 'my own edits', JSON.stringify(r2));

  // ---- 项目页 ----
  const projDir = path.join(tmp, 'app'); fs.mkdirSync(projDir);
  const w = await req({ kind: 'workspaces.add', path: projDir });
  const wid = w?.id ?? (await req({ kind: 'sessions.projects' })).find((x) => path.resolve(x.path).toLowerCase() === projDir.toLowerCase())?.id;
  const upd = await req({ kind: 'workspaces.update', id: wid, instructions: 'Use pnpm. Answer briefly.', sessionsScope: 'project', permissionMode: 'acceptEdits' });
  check('workspaces.update: instructions, sessions scope, permission mode', upd.instructions === 'Use pnpm. Answer briefly.' && upd.sessionsScope === 'project' && upd.permissionMode === 'acceptEdits', JSON.stringify(upd));
  const noTokFile = await post(`/api/project-files?workspaceId=${wid}&name=notes.md`, 'x', false);
  const fileUp = await post(`/api/project-files?workspaceId=${wid}&name=notes.md`, '# notes for the project');
  const badName = await post(`/api/project-files?workspaceId=${wid}&name=..%2Fescape.md`, 'x');
  check('project files: upload needs the token, a bad name is refused', noTokFile.status === 403 && fileUp.status === 200 && badName.status !== 200, `${noTokFile.status} ${fileUp.status} ${badName.status}`);
  const files = await req({ kind: 'projects.files.list', workspaceId: wid });
  check('projects.files.list: the file, in <data>/projects/<id>/', files.files.some((f) => f.name === 'notes.md') && files.dir.replace(/\\/g, '/').endsWith(`.claude-web/projects/${wid}`) && fs.existsSync(path.join(files.dir, 'notes.md')), files.dir);
  check('nothing escaped the project files folder', !fs.existsSync(path.join(files.dir, '..', 'escape.md')));

  // ---- 派活 ----
  const d0 = await req({ kind: 'dispatch.defaults' });
  check('dispatch.defaults: the projects to pick from', d0.workspaces.some((x) => x.id === wid));
  const started = await req({ kind: 'dispatch.start', prompt: 'list the files in this project', workspaceId: wid, from: 'phone' });
  opened.push(started.sessionId);
  const meta = await until(async () => { const m = await req({ kind: 'sessions.meta' }); return m[started.sessionId]?.origin === 'dispatch' ? m[started.sessionId] : null; });
  check("dispatch.start: a new conversation marked as dispatched, in the project", !!meta && meta.dispatchFrom === 'phone' && meta.workspaceId === wid, JSON.stringify(meta ?? null));
  const d1 = await req({ kind: 'dispatch.defaults' });
  check('dispatch.defaults: 上次的 project is remembered', d1.last.workspaceId === wid, JSON.stringify(d1.last));
  const empty = await req({ kind: 'dispatch.start', prompt: '   ' }).then(() => null, (e) => e.message);
  check('dispatch.start: an empty task is refused', !!empty, empty ?? '');
  await req({ kind: 'projects.files.remove', workspaceId: wid, name: 'notes.md' });
  const after = await req({ kind: 'projects.files.list', workspaceId: wid });
  check('projects.files.remove', !after.files.length);
} catch (e) {
  check('phase 39 ran without throwing', false, e.stack ?? String(e));
} finally {
  for (const id of opened) await req({ kind: 'session.close', sessionId: id }).catch(() => {});
  ws.close();
  await sleep(300);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* fine */ }
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\nphase 39: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
