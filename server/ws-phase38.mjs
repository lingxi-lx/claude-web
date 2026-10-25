// Phase 38 end-to-end (stage F5): 发布. A page with a stylesheet and a picture is published → `/p/<id>/` opens with
// no token, sandboxed (CSP without same-origin, nosniff); traversal / unknown ids are 404 (never the app); the LAN
// link exists only while remote listening is on and works on that listener without a token while the app there
// still wants one; 重新发布 keeps the id; 撤回 → 404; 导出成单个 HTML inlines the files.
//   node server/ws-phase38.mjs [port] [token]
import WebSocket from 'ws';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const port = args[0] ?? '3090';
const token = args[1];
const results = [];
const check = (name, ok, detail = '') => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '0.0.0.0', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
/** a raw request path (no client-side normalising), with a cookie that must not matter */
const get = (p, at = port) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: Number(at), path: p, method: 'GET' }, (res) => { let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body })); });
  r.on('error', reject); r.end();
});

const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${token ? `?token=${token}` : ''}`);
let seq = 0;
const pending = new Map();
ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.type === 'reply') { const p = pending.get(m.reply.id); pending.delete(m.reply.id); m.reply.ok ? p.res(m.reply.data) : p.rej(new Error(m.reply.error)); } });
const req = (r) => new Promise((res, rej) => { const id = String(++seq); pending.set(id, { res, rej }); ws.send(JSON.stringify({ type: 'request', request: { id, req: r } })); });
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-e2e-pub-'));
fs.mkdirSync(path.join(dir, 'img'));
fs.writeFileSync(path.join(dir, 'page.html'), '<!doctype html><link rel="stylesheet" href="style.css"><img src="img/dot.png"><h1>v1</h1><script>try{document.title=String(localStorage.length)}catch(e){document.title="sandboxed"}</script>');
fs.writeFileSync(path.join(dir, 'style.css'), 'h1{color:teal}');
fs.writeFileSync(path.join(dir, 'img', 'dot.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
fs.writeFileSync(path.join(dir, 'secret.txt'), 'not referenced by the page');
let remoteOn = false;
try {
  const it = await req({ kind: 'publish.create', path: path.join(dir, 'page.html'), expiry: '7d' });
  check('publish.create: a 128-bit id and a local link', /^[0-9a-f]{32}$/.test(it.id) && it.localUrl === `http://127.0.0.1:${port}/p/${it.id}/` && it.files === 3, `${it.id} files=${it.files}`);
  check('publish.create: 7 days', typeof it.expiresAt === 'number' && Math.abs(it.expiresAt - Date.now() - 7 * 86_400_000) < 60_000);
  const page = await get(`/p/${it.id}/`);
  check('GET /p/<id>/ with no token → the page', page.status === 200 && page.body.includes('<h1>v1</h1>'), String(page.status));
  check('sandboxed: CSP sandbox allow-scripts allow-popups (no same-origin) + nosniff', page.headers['content-security-policy'] === 'sandbox allow-scripts allow-popups' && page.headers['x-content-type-options'] === 'nosniff', JSON.stringify([page.headers['content-security-policy'], page.headers['x-content-type-options']]));
  const css = await get(`/p/${it.id}/style.css`);
  const png = await get(`/p/${it.id}/img/dot.png`);
  check("the page's own files are in the snapshot", css.status === 200 && css.body === 'h1{color:teal}' && png.status === 200 && /image\/png/.test(png.headers['content-type']));
  const bad = [];
  for (const p of [`/p/${it.id}/secret.txt`, `/p/${it.id}/../index.json`, `/p/${it.id}/%2e%2e/index.json`, `/p/${it.id}/..%2findex.json`, `/p/${it.id}/..%5c..%5cindex.json`, `/p/${'f'.repeat(32)}/`, '/p/../api/file', '/p/']) {
    const r = await get(p);
    if (r.status !== 404 || r.body.includes('<div id="root"') || r.body.includes('"source"')) bad.push(`${p} → ${r.status}`);
  }
  check('traversal, files not in the snapshot and unknown ids are 404, never the app', bad.length === 0, bad.join(', '));
  const l0 = await req({ kind: 'publish.list' });
  check('publish.list: no LAN link while remote listening is off', l0.lan === null && l0.items.some((x) => x.id === it.id && x.lanUrl === null));

  const rp = await freePort();
  const st = await req({ kind: 'remote.set', enabled: true, port: rp });
  remoteOn = st.running;
  const l1 = await req({ kind: 'publish.list' });
  const lanItem = l1.items.find((x) => x.id === it.id);
  check('publish.list: the LAN link once remote listening is on', !!l1.lan && !!lanItem?.lanUrl && lanItem.lanUrl.endsWith(`:${rp}/p/${it.id}/`), lanItem?.lanUrl ?? String(l1.lan));
  const viaLan = await get(`/p/${it.id}/`, rp);
  const appLan = await get('/api/file?path=x', rp);
  check('on the LAN listener: the published page needs no token; the app still does', viaLan.status === 200 && viaLan.headers['content-security-policy'] === 'sandbox allow-scripts allow-popups' && appLan.status === 403, `${viaLan.status} / ${appLan.status}`);
  await req({ kind: 'remote.set', enabled: false });
  remoteOn = false;

  fs.writeFileSync(path.join(dir, 'page.html'), '<h1>v2</h1>');
  const again = await req({ kind: 'publish.create', path: path.join(dir, 'page.html'), expiry: 'never', id: it.id });
  const page2 = await get(`/p/${it.id}/`);
  check('重新发布: the same id, the new snapshot, now permanent', again.id === it.id && again.expiresAt === null && page2.body.includes('v2'));
  const one = await req({ kind: 'publish.inline', path: path.join(dir, 'page.html') });
  check('导出成单个 HTML: a file under the data dir', fs.existsSync(one.path) && fs.readFileSync(one.path, 'utf8').includes('v2'), one.path);
  await req({ kind: 'publish.revoke', id: it.id });
  const gone = await get(`/p/${it.id}/`);
  const l2 = await req({ kind: 'publish.list' });
  check('撤回: 404 and gone from the list', gone.status === 404 && !l2.items.some((x) => x.id === it.id));
  const refused = await req({ kind: 'publish.create', path: dir, expiry: '7d' }).then(() => null, (e) => e.message);
  check('a folder cannot be published', !!refused, refused ?? '');
} catch (e) {
  check('phase 38 ran without throwing', false, e.stack ?? String(e));
} finally {
  if (remoteOn) await req({ kind: 'remote.set', enabled: false }).catch(() => {});
  ws.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* fine */ }
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\nphase 38: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
