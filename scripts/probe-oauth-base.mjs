// Does an engine logged in with an OAuth token still send it when ANTHROPIC_BASE_URL points at a local address?
// A fake token, a temp HOME, a local server that logs the first /v1/messages request's headers and answers an error.
// node scripts/probe-oauth-base.mjs   (uses the bundled engines; touches nothing of the user's)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const { resolveEngine } = await import('../server/dist/claude-exe.js');
const seen = [];
const srv = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization ?? null, xkey: req.headers['x-api-key'] ?? null, beta: req.headers['anthropic-beta'] ?? null, model: (() => { try { return JSON.parse(body).model; } catch { return null; } })() });
    if (!/\/v1\/messages/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/json' }).end('{}'); return; } res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'probe' } }));
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

async function probe(kind) {
  const eng = resolveEngine(kind);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-oauth-probe-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/gateway/~s/tok/k/key`, CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-FAKEPROBE', CLAUDE_CODE_SUBAGENT_MODEL: 'cw-sub/x', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' };
  for (const k of Object.keys(env)) if (/^(ANTHROPIC_(API_KEY|AUTH_TOKEN|DEFAULT_|MODEL)|CLAUDE_CODE_ENTRYPOINT|CLAUDE_CODE_USE_|HTTPS?_PROXY|https?_proxy)/.test(k)) delete env[k];
  const before = seen.length;
  const isJs = /\.(c?m?js)$/.test(eng.file);
  const cmd = isJs ? process.execPath : eng.file;
  const args = [...(isJs ? [eng.file] : []), '-p', 'hi', '--max-turns', '1'];
  await new Promise((resolve) => {
    const p = spawn(cmd, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => p.kill(), 25000);
    const iv = setInterval(() => { if (seen.slice(before).some((x) => /\/v1\/messages/.test(x.url))) { clearInterval(iv); clearTimeout(t); p.kill(); } }, 200);
    p.on('exit', () => { clearInterval(iv); clearTimeout(t); resolve(); });
  });
  fs.rmSync(home, { recursive: true, force: true });
  console.log(kind, eng.file.split(/[\\/]/).slice(-3).join('/'), JSON.stringify(seen.slice(before).filter((x) => /messages/.test(x.url)).slice(0, 2)));
}
for (const k of ['claude', 'ccb']) { try { await probe(k); } catch (e) { console.log(k, 'error', e.message); } }
srv.close();
