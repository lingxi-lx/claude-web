// Phase 31's Gemini sidecar: the admin API and the data plane, with the tokens the adapter generated. Not part of
// the server; ws-phase31.mjs spawns it through CW_SIDECAR_GEMINI_CMD.
import http from 'node:http';

const argv = process.argv;
const port = Number(argv[argv.indexOf('--port') + 1]);
const admin = process.env.ADMIN_TOKEN ?? '';
const apiKey = process.env.API_KEY ?? '';
let next = 1;
const cookies = [];

// the server that started us goes away on a failed run too; never outlive it
setInterval(() => { try { process.kill(process.ppid, 0); } catch { process.exit(0); } }, 2000).unref();

const json = (s, status, o) => s.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(o));
const authOf = (q) => String(q.headers.authorization ?? '');

const server = http.createServer((q, s) => {
  let body = '';
  q.on('data', (c) => { body += c; });
  q.on('end', () => {
    const path = new URL(q.url ?? '/', 'http://x').pathname;
    const method = q.method ?? 'GET';
    if (path === '/healthz') return json(s, 200, { ok: true });
    if (path === '/v1/models') {
      if (authOf(q) !== `Bearer ${apiKey}`) return json(s, 401, { error: 'bad data key' });
      return json(s, 200, { data: [{ id: 'gemini-3.6-flash' }, { id: 'gemini-3.1-pro' }] });
    }
    if (path === '/v1/chat/completions') {
      if (authOf(q) !== `Bearer ${apiKey}`) return json(s, 401, { error: 'bad data key' });
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch { /* keep */ }
      return json(s, 200, {
        id: 'chatcmpl-fake', object: 'chat.completion', model: j.model ?? 'gemini-3.6-flash',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hello from gemini' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      });
    }
    if (!path.startsWith('/admin/api/')) return json(s, 404, { error: 'no' });
    if (authOf(q) !== `Bearer ${admin}`) return json(s, 401, { error: 'bad admin token' });

    if (path === '/admin/api/config') return json(s, 200, { models: ['gemini-3.6-flash', 'gemini-3.1-pro'], config: {} });
    if (path === '/admin/api/cookies' && method === 'GET') return json(s, 200, { items: cookies, total: cookies.length, enabled: cookies.filter((c) => c.status === 'enabled').length });
    if (path === '/admin/api/cookies' && method === 'POST') {
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch { /* keep */ }
      if (!String(j.cookie ?? '').trim()) return json(s, 400, { error: 'cookie required' });
      const id = next++;
      cookies.push({ id, label: j.label || `Gemini ${id}`, status: 'enabled', health: 'ok' });
      return json(s, 200, { id });
    }
    const m = /^\/admin\/api\/cookies\/(\d+)(\/[a-z]+)?$/.exec(path);
    if (m) {
      const c = cookies.find((x) => x.id === Number(m[1]));
      if (!c) return json(s, 404, { error: 'no cookie' });
      if (!m[2] && method === 'PATCH') {
        let j = {};
        try { j = JSON.parse(body || '{}'); } catch { /* keep */ }
        if (j.label !== undefined) c.label = j.label;
        if (j.status !== undefined) c.status = j.status;
        return json(s, 200, { ok: true });
      }
      if (!m[2] && method === 'DELETE') {
        cookies.splice(cookies.indexOf(c), 1);
        return json(s, 200, { ok: true });
      }
      if (m[2] === '/check') return json(s, 200, { ok: true, detail: 'ok' });
      if (m[2] === '/rotate') return json(s, 200, { ok: true, detail: 'kept alive' });
    }
    return json(s, 404, { error: 'no' });
  });
});
server.listen(port, '127.0.0.1', () => console.log(`fake gemini sidecar on ${port}`));
