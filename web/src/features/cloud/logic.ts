// Stage F (local versions of claude.ai features): the pure parts of the screens — which conversations a project page
// lists, the links a published file has, who may be handed to the always-on machine, an upload with the app's token.
import type { PublishedItem, SessionMeta, SessionSummary, Workspace } from '@shared';
import { authToken } from '@/ws/client';
import { appUrl } from '@/util/app-url';
import { isImportedSessionId } from '@/util';
import { tr } from '@/i18n';

const key = (p: string, caseless: boolean) => { const s = p.replace(/\\/g, '/').replace(/\/+$/, ''); return caseless ? s.toLowerCase() : s; };
const same = (a: string | undefined, b: string, caseless: boolean) => !!a && !!b && key(a, caseless) === key(b, caseless);
const windows = () => typeof navigator !== 'undefined' && /win/i.test(navigator.platform || navigator.userAgent || '');

/** The project's conversations (the server's projectOf rule: meta.workspaceId, else the main folder), newest first. */
export function projectSessions(sessions: readonly SessionSummary[], w: Pick<Workspace, 'id' | 'path'>, meta: Readonly<Record<string, SessionMeta | undefined>>, caseless = windows()): SessionSummary[] {
  return sessions
    .filter((s) => {
      if (s.peer) return false;
      const m = meta[s.sessionId];
      if (m?.workspaceId) return m.workspaceId === w.id;
      return same(s.cwd, w.path, caseless) || same(m?.groupCwd, w.path, caseless);
    })
    .slice()
    .sort((a, b) => b.lastModified - a.lastModified);
}

export interface PublishLinks { local: string | null; lan: string | null; peer: string | null }

/** A published item's links: here (this computer only), on the LAN (only with remote listening), or the peer's. */
export function publishLinks(it: PublishedItem & { localUrl?: string; lanUrl?: string | null }): PublishLinks {
  if (it.peerId) return { local: null, lan: null, peer: it.url ?? null };
  return { local: it.localUrl ?? null, lan: it.lanUrl ?? null, peer: null };
}

/** When a published item stops working, in words. */
export function expiryText(expiresAt: number | null, now = Date.now()): string {
  if (expiresAt === null) return tr('永久');
  const ms = expiresAt - now;
  if (ms <= 0) return tr('已过期');
  const h = Math.ceil(ms / 3_600_000);
  return h < 48 ? tr('{n} 小时后过期', { n: h }) : tr('{n} 天后过期', { n: Math.ceil(h / 24) });
}

/** 交给常开机器继续 is for this machine's own Claude conversations (the hand-off replays them as a Claude transcript). */
export function canHandOffToPeer(s: Pick<SessionSummary, 'sessionId' | 'peer' | 'agent'>, meta?: SessionMeta): boolean {
  return !s.peer && (s.agent ?? 'claude') === 'claude' && !isImportedSessionId(s.sessionId) && !meta?.handedOff;
}

/** POST a file to one of the app's upload endpoints (`api/…?…`), with the token like every other request. */
export function uploadTo<T = unknown>(apiPath: string, body: Blob, onProgress?: (p: number) => void): Promise<T> {
  const tok = authToken();
  const url = appUrl(`${apiPath}${apiPath.includes('?') ? '&' : '?'}${tok ? `token=${encodeURIComponent(tok)}` : ''}`);
  return new Promise((res, rej) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status !== 200) { rej(new Error(tr('上传失败 {status}: {responseText}', { status: xhr.status, responseText: xhr.responseText }))); return; }
      try { res(JSON.parse(xhr.responseText) as T); } catch { rej(new Error(tr('上传失败：网络错误'))); }
    };
    xhr.onerror = () => rej(new Error(tr('上传失败：网络错误')));
    xhr.send(body);
  });
}
