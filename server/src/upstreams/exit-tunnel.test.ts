import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { startExitTunnel, probeExit } from './exit-tunnel.js';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

/** A TCP server that echoes what it gets: stands in for the site behind the exit. */
async function echoServer(): Promise<number> {
  const s = net.createServer((c) => c.pipe(c));
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => ok()));
  cleanups.push(() => new Promise<void>((ok) => s.close(() => ok())));
  return (s.address() as net.AddressInfo).port;
}

/** A stand-in exit: an HTTP proxy that either tunnels, refuses, or demands a password. */
async function upstreamProxy(opts: { auth?: string; refuse?: boolean } = {}): Promise<number> {
  const s = http.createServer();
  s.on('connect', (req, client) => {
    if (opts.auth && req.headers['proxy-authorization'] !== opts.auth) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      return;
    }
    if (opts.refuse) {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const [host, port] = (req.url ?? '').split(':');
    const up = net.connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      up.pipe(client);
      client.pipe(up);
    });
    up.on('error', () => client.destroy());
  });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => ok()));
  cleanups.push(() => new Promise<void>((ok) => s.close(() => ok())));
  return (s.address() as net.AddressInfo).port;
}

/** CONNECT through the loopback tunnel and return the raw socket. */
function connectThrough(port: number, host: string, target: number): Promise<{ sock: net.Socket; status: string }> {
  return new Promise((ok, no) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(`CONNECT ${host}:${target} HTTP/1.1\r\nHost: ${host}:${target}\r\n\r\n`));
    let buf = '';
    const onData = (d: Buffer) => {
      buf += d.toString('latin1');
      const at = buf.indexOf('\r\n\r\n');
      if (at < 0) return;
      sock.off('data', onData);
      const rest = buf.slice(at + 4);
      if (rest) sock.unshift(Buffer.from(rest, 'latin1'));
      ok({ sock, status: buf.slice(0, at).split('\r\n')[0] });
    };
    sock.on('data', onData);
    sock.on('error', no);
  });
}

describe('exit tunnel', () => {
  it('carries a CONNECT through the exit and back', async () => {
    const target = await echoServer();
    const exit = await upstreamProxy();
    const t = await startExitTunnel(`http://127.0.0.1:${exit}`);
    cleanups.push(() => t.close());
    const { sock, status } = await connectThrough(t.port, '127.0.0.1', target);
    expect(status).toContain('200');
    const got = await new Promise<string>((ok) => {
      sock.once('data', (d: Buffer) => ok(d.toString('utf8')));
      sock.write('ping');
    });
    expect(got).toBe('ping');
    sock.destroy();
  });

  it('sends the exit its credentials', async () => {
    const target = await echoServer();
    const exit = await upstreamProxy({ auth: `Basic ${Buffer.from('me:s3cret').toString('base64')}` });
    const t = await startExitTunnel(`http://me:s3cret@127.0.0.1:${exit}`);
    cleanups.push(() => t.close());
    const { sock, status } = await connectThrough(t.port, '127.0.0.1', target);
    expect(status).toContain('200');
    sock.destroy();
  });

  it('answers 502 when the exit refuses', async () => {
    const target = await echoServer();
    const exit = await upstreamProxy({ refuse: true });
    const t = await startExitTunnel(`http://127.0.0.1:${exit}`);
    cleanups.push(() => t.close());
    const { sock, status } = await connectThrough(t.port, '127.0.0.1', target);
    expect(status).toContain('502');
    sock.destroy();
  });

  it('probeExit fails on a dead exit (so the window is never opened direct)', async () => {
    const port = await upstreamProxy({ refuse: true });
    await expect(probeExit(`http://127.0.0.1:${port}`, '127.0.0.1', 443)).rejects.toThrow();
  });
});
