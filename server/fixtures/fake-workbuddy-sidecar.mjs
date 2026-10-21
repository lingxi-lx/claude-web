// Phase 31's WorkBuddy sidecar: its config file, the account pool, the panel API the adapter drives, and the
// OpenAI-compatible data plane. ws-phase31.mjs spawns it through CW_SIDECAR_WORKBUDDY_CMD.
import fs from 'node:fs';
import http from 'node:http';

const argv = process.argv;
const cfgPath = argv[argv.indexOf('--config') + 1];
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const port = Number(String(cfg.listen).split(':')[1]);
const apiKey = cfg.api_key;
const accounts = new Map();
let polls = 0;

setInterval(() => { try { process.kill(process.ppid, 0); } catch { process.exit(0); } }, 2000).unref();

const json = (s, status, o) => s.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(o));
const authOf = (q) => String(q.headers.authorization ?? '');
const add = (uid, nickname) => {
  if (!accounts.has(uid)) accounts.set(uid, { uid, nickname: nickname || `WB ${uid}`, disabled: false, cooling: false, credits: 10, credits_total: 20 });
  return accounts.get(uid);
};

const server = http.createServer((q, s) => {
  let body = '';
  q.on('data', (c) => { body += c; });
  q.on('end', () => {
    const path = new URL(q.url ?? '/', 'http://x').pathname;
    const method = q.method ?? 'GET';
    if (path === '/healthz') return json(s, 200, { ok: true });
    if (path === '/panel/api/login/start' && method === 'POST') return json(s, 200, { ok: true, url: 'https://login.example/workbuddy', state: 'st1', realm: 'cn' });
    if (path === '/panel/api/login/poll') {
      polls++;
      if (polls < 2) return json(s, 200, { done: false });
      add('u1', 'Logged in');
      return json(s, 200, { done: true, uid: 'u1' });
    }
    if (authOf(q) !== `Bearer ${apiKey}`) return json(s, 401, { error: 'bad key' });
    if (path === '/v1/models') return json(s, 200, { data: [{ id: 'glm-5.2' }] });
    if (path === '/v1/chat/completions') {
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch { /* keep */ }
      return json(s, 200, {
        id: 'chatcmpl-wb', object: 'chat.completion', model: j.model ?? 'glm-5.2',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hello from workbuddy' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      });
    }
    if (path === '/panel/api/overview') {
      const list = [...accounts.values()];
      return json(s, 200, { version: '1.13.0', total: list.length, healthy: list.filter((a) => !a.disabled).length, accounts: list });
    }
    if (path === '/panel/api/import/cockpit' && method === 'POST') {
      for (const m of body.matchAll(/"uid"\s*:\s*"([^"]+)"/g)) add(m[1]);
      return json(s, 200, { ok: true, imported: accounts.size });
    }
    const m = /^\/panel\/api\/(?:accounts\/([^/]+)\/([a-z_]+(?:\/[a-z_]+)?)|(checkin_all|travel_all|activity_all|keepalive_all))$/.exec(path);
    if (m) {
      const a = m[1] ? accounts.get(decodeURIComponent(m[1])) : null;
      if (m[1] && !a) return json(s, 404, { error: 'no account' });
      const action = m[2] ?? m[3];
      if (a) {
        if (action === 'disable') { a.disabled = true; return json(s, 200, { ok: true }); }
        if (action === 'revive') { a.disabled = false; return json(s, 200, { ok: true }); }
        if (action === 'remove') { accounts.delete(a.uid); return json(s, 200, { ok: true }); }
        if (action === 'balance') { a.credits = 12; return json(s, 200, { ok: true, credits: 12, credits_total: 20 }); }
        if (action === 'checkin') return json(s, 200, { ok: true, checkin_done: true });
        if (action === 'tasks/auto_all') return json(s, 200, { ok: true, results: [] });
      }
      return json(s, 200, { ok: true, started: true });
    }
    return json(s, 404, { error: 'no' });
  });
});
server.listen(port, '127.0.0.1', () => console.log(`fake workbuddy sidecar on ${port}`));
