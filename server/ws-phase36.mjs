// Phase 36 end-to-end (2026-10-25, stage E5): the WSL / SSH backends, read-only.
//   · wsl.list has the right shape (not Windows: available false; Windows without WSL: no distros — not a failure);
//   · wsl.install without `confirmed` is refused (the install only runs after the user saw the command);
//   · remote.hosts.test against a closed port answers unreachable (or no-ssh where ssh is missing), within 20 s;
//     a target that is an ssh option is refused;
//   · a WSL conversation in a distro that does not exist is refused before anything starts.
//   node server/ws-phase36.mjs [port] [token]
import WebSocket from 'ws';
import os from 'node:os';

const port = process.argv[2] ?? '3090';
const token = process.argv[3];
const results = [];
const check = (name, ok, detail = '') => { results.push([name, !!ok]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${token ? `?token=${token}` : ''}`);
let seq = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type !== 'reply') return;
  const p = pending.get(m.reply.id);
  if (!p) return;
  pending.delete(m.reply.id);
  m.reply.ok ? p.res(m.reply.data) : p.rej(new Error(m.reply.error));
});
const req = (r) => new Promise((res, rej) => { const id = String(++seq); pending.set(id, { res, rej }); ws.send(JSON.stringify({ type: 'request', request: { id, req: r } })); });
const refused = async (r) => { try { await req(r); return ''; } catch (e) { return String(e.message || 'refused'); } };

try {
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const l = await req({ kind: 'wsl.list' });
  const win = process.platform === 'win32';
  check('wsl.list: { available, distros[] }', typeof l.available === 'boolean' && Array.isArray(l.distros) && (win || l.available === false) && l.distros.every((d) => typeof d.name === 'string' && !/^docker-desktop/.test(d.name)), JSON.stringify(l));
  check('wsl.install without confirmed is refused', !!(await refused({ kind: 'wsl.install', distro: l.distros[0]?.name ?? 'Ubuntu' })));
  const cmd = await req({ kind: 'wsl.installCommand' });
  check('wsl.installCommand is the official installer, shown word for word', cmd.command === 'curl -fsSL https://claude.ai/install.sh | bash');

  const t0 = Date.now();
  const probe = await req({ kind: 'remote.hosts.test', target: 'nobody@127.0.0.1', sshPort: 1 });
  check('remote.hosts.test to a closed port: unreachable / no-ssh, within 20 s', ['unreachable', 'no-ssh'].includes(probe.ssh) && Date.now() - t0 < 20_000, JSON.stringify(probe));
  check('remote.hosts.test refuses an ssh option as the target', !!(await refused({ kind: 'remote.hosts.test', target: '-oProxyCommand=x' })));

  const why = await refused({ kind: 'session.open', params: { cwd: os.tmpdir(), env: { kind: 'wsl', distro: 'NoSuchDistro' } } });
  check('a WSL conversation in a distro that does not exist is refused', win ? /没有这个 WSL 发行版|WSL/.test(why) : /WSL/.test(why), why);
} catch (e) {
  check('phase 36 ran', false, String(e?.stack ?? e));
}
ws.close();
const failed = results.filter(([, ok]) => !ok);
console.log(failed.length ? `\nphase 36: ${failed.length} failed` : `\nphase 36: all ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
