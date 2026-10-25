// Upload endpoints without an app token (local browser mode trusts loopback): a page on some other website could still
// POST to 127.0.0.1 from the user's browser. Those requests carry `Sec-Fetch-Site: cross-site` (or an `Origin` that is
// not this server), so only same-origin ones — or ones with neither header (curl, the desktop shell) — get through.
import type http from 'node:http';

export function sameOriginRequest(req: Pick<http.IncomingMessage, 'headers'>): boolean {
  const site = String(req.headers['sec-fetch-site'] ?? '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (origin === 'null') return false;
  try {
    return new URL(String(origin)).host.toLowerCase() === String(req.headers.host ?? '').toLowerCase();
  } catch {
    return false;
  }
}
