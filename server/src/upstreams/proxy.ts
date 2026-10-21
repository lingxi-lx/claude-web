// One account's proxy: an agent kept per proxy URL (agents are re-usable and hold keep-alive sockets).
// http(s) through https-proxy-agent, socks4/5 through socks-proxy-agent; anything else is refused when saved.
import http from 'node:http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

const cache = new Map<string, http.Agent>();

/** The URL scheme an account proxy may use; null for anything else (refused at save time). */
export function normalizeAccountProxy(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (!/^(https?|socks4a?|socks5h?):\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    return u.hostname ? u.toString() : null;
  } catch { return null; }
}

export function accountProxyAgent(proxy: string): http.Agent | undefined {
  const hit = cache.get(proxy);
  if (hit) return hit;
  let agent: http.Agent | undefined;
  try {
    agent = /^socks/i.test(proxy)
      ? (new SocksProxyAgent(proxy) as unknown as http.Agent)
      : (new HttpsProxyAgent(proxy) as unknown as http.Agent);
  } catch {
    return undefined;
  }
  cache.set(proxy, agent);
  return agent;
}

/** A proxy URL as the UI may see it: any user / password in it is secret. */
export function maskProxyUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.username) u.username = '***';
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return raw.replace(/\/\/[^@/]*@/, '//***@');
  }
}
