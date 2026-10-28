// Wire-level fingerprint for node:http(s) requests: an Agent that (1) rewrites the request's header block into the
// profile's order and casing — Host, Connection and Content-Length included, which Node otherwise places itself — and
// (2) hands the inner agent the profile's TLS options (ciphers / sigalgs / groups / ALPN / versions), or (3) sends the
// connection through the tlsfp helper, which makes the ClientHello with uTLS (helpers/tlsfp).
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { NodeTlsShape } from './profiles.js';

type HeaderValue = string | number | string[];

/** Re-set every header of a not-yet-sent request in `order` (CPA httpwire.orderRequestHeader, done before Node writes it). */
export function reorderRequestHeaders(req: http.ClientRequest, order: readonly string[], keepAlive: boolean): void {
  if (req.headersSent) return;
  const names = req.getRawHeaderNames();
  const pairs: [string, HeaderValue][] = [];
  for (const n of names) { const v = req.getHeader(n); if (v !== undefined) pairs.push([n, v]); }
  const has = (l: string) => pairs.some(([n]) => n.toLowerCase() === l);
  // Node adds Connection while writing (at the end); a profile that places it gets it where it belongs
  if (order.some((n) => n.toLowerCase() === 'connection') && !has('connection')) pairs.push(['Connection', keepAlive ? 'keep-alive' : 'close']);
  const out: [string, HeaderValue][] = [];
  const used = new Set<number>();
  for (const name of order) {
    const l = name.toLowerCase();
    pairs.forEach(([n, v], i) => { if (!used.has(i) && n.toLowerCase() === l) { out.push([name, v]); used.add(i); } });
  }
  pairs.forEach((p, i) => { if (!used.has(i)) out.push(p); });
  for (const [n] of pairs) req.removeHeader(n);
  for (const [n, v] of out) req.setHeader(n, v);
}

/** Options a node:tls connect takes from the profile. */
export function tlsOptions(t: NodeTlsShape): Record<string, unknown> {
  const o: Record<string, unknown> = { minVersion: t.minVersion, maxVersion: t.maxVersion, ALPNProtocols: t.ALPNProtocols };
  if (t.ciphers) o.ciphers = t.ciphers;
  if (t.sigalgs) o.sigalgs = t.sigalgs;
  if (t.ecdhCurve) o.ecdhCurve = t.ecdhCurve;
  if (t.requestOCSP) o.requestOCSP = true;
  return o;
}

/**
 * Wraps the agent a request would have used (direct, the process proxy, an account proxy): orders the headers, then
 * passes the request on with the TLS options merged in. https.Agent and agent-base proxies both feed request options
 * into tls.connect (and into the pool key), so the shaped connections never mix with plain ones.
 */
export class ShapedAgent extends http.Agent {
  constructor(private readonly inner: http.Agent, private readonly tls: Record<string, unknown> | null, private readonly order: (path: string) => readonly string[], protocol: 'http:' | 'https:') {
    super({ keepAlive: (inner as any).keepAlive !== false });
    (this as any).protocol = protocol;
    (this as any).defaultPort = protocol === 'https:' ? 443 : 80;
    (this as any).keepAlive = !!(inner as any).keepAlive;
  }

  addRequest(req: http.ClientRequest, options: Record<string, unknown>): void {
    reorderRequestHeaders(req, this.order(req.path), !!(this.inner as any).keepAlive);
    (this.inner as any).addRequest(req, this.tls ? { ...options, ...this.tls } : options);
  }

  // the inner agent is shared: it owns its sockets
  destroy(): void { /* nothing of our own */ }
}

/** The helper's per-connection preface: the target, the profile and the proxy (or '-'), behind its token. */
export function helperPreface(token: string, profile: string, host: string, port: number, proxy: string | null): string {
  const clean = (s: string) => s.replace(/[\s\r\n]+/g, '');
  return `CWFP/1 ${clean(token)} ${clean(profile)} ${clean(host)} ${port} ${proxy ? clean(proxy) : '-'}\n`;
}

/**
 * Connections to an https origin made by the tlsfp helper: Node writes plain HTTP/1.1 into a loopback socket, the helper
 * dials the origin (through the proxy, if any) with the profile's ClientHello and pipes the bytes both ways.
 */
export class HelperAgent extends http.Agent {
  constructor(private readonly endpoint: () => { port: number; token: string } | null, private readonly profile: string, private readonly proxy: string | null) {
    super({ keepAlive: true });
    (this as any).protocol = 'https:';
    (this as any).defaultPort = 443;
  }

  // returns the socket synchronously (Node's Agent then uses it; the callback is not called)
  createConnection(options: http.ClientRequestArgs): net.Socket {
    const ep = this.endpoint();
    const sock = net.connect({ host: '127.0.0.1', port: ep?.port ?? 1 });
    if (!ep) { queueMicrotask(() => sock.destroy(new Error('tlsfp helper is not running'))); return sock; }
    const o = options as http.ClientRequestArgs & { servername?: string };
    const host = String(o.servername || o.host || o.hostname || '').replace(/^\[|\]$/g, '');
    sock.write(helperPreface(ep.token, this.profile, host, Number(o.port) || 443, this.proxy));
    return sock;
  }
}

const direct = { http: new http.Agent({ keepAlive: true }), https: new https.Agent({ keepAlive: true }) };
export const directAgent = (protocol: string): http.Agent => (protocol === 'https:' ? direct.https : direct.http);
