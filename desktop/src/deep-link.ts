// 深链接 (spec 2026-10-16 sessions-env §7): `claude-web://new?folder=…&q=…&peer=…` opens the new-conversation page filled
// in (never sent), `claude-web://session/<id>` opens a conversation. Everything in a link is checked here: it comes from
// any web page or document that links to it.
export const SCHEME = 'claude-web';
const MAX_Q = 10_000;

export type DeepLink =
  | { kind: 'new'; folder?: string; q?: string; peer?: string }
  | { kind: 'session'; id: string };

/** `isDir` decides whether a folder may be prefilled (a folder that is not there is dropped, not passed on). */
export function parseDeepLink(raw: string, isDir: (p: string) => boolean): DeepLink | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== `${SCHEME}:`) return null;
  // claude-web://new?… parses with `new` as the host; claude-web:new?… as the path
  const route = (u.host || u.pathname.replace(/^\/+/, '').split('/')[0]).toLowerCase();
  const rest = u.host ? u.pathname.replace(/^\/+/, '') : u.pathname.replace(/^\/+/, '').split('/').slice(1).join('/');
  if (route === 'session') {
    const id = decodeURIComponent(rest);
    return /^[\w~.-]{1,200}$/.test(id) ? { kind: 'session', id } : null;
  }
  if (route !== 'new') return null;
  const out: DeepLink = { kind: 'new' };
  const folder = u.searchParams.get('folder');
  if (folder && folder.length < 4096 && isDir(folder)) out.folder = folder;
  const q = u.searchParams.get('q');
  if (q) out.q = q.slice(0, MAX_Q);
  const peer = u.searchParams.get('peer');
  if (peer && /^[\w.-]{1,100}$/.test(peer)) out.peer = peer;
  return out;
}

/** The link a launch carries: Windows / Linux pass it as an argument (the first launch and every second instance). */
export function linkFromArgv(argv: readonly string[]): string | null {
  return argv.find((a) => a.toLowerCase().startsWith(`${SCHEME}:`)) ?? null;
}
