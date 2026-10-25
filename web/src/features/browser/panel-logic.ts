// The browser panel's small decisions (stage B task 3), kept apart from React so they can be tested: the loading
// bar, a tab's page zoom, the downloads bar's rows.

/**
 * The thin bar under the address bar. A <webview> says when a load starts, when the page is committed, when its DOM
 * is ready and when it stops — no real percentage — so each of those moves the bar on (never back) and the CSS
 * eases between them. undefined: no bar.
 */
export type LoadEvent = 'start' | 'navigate' | 'ready' | 'stop';
export function progressOn(cur: number | undefined, ev: LoadEvent): number | undefined {
  if (ev === 'start') return cur === undefined || cur >= 1 ? 0.1 : cur;
  if (ev === 'stop') return 1;
  if (cur === undefined || cur >= 1) return cur; // an in-page jump, or a late event after the load was over
  return Math.max(cur, ev === 'navigate' ? 0.45 : 0.8);
}

/** A browser's zoom steps (Chrome's, without the extremes). */
export const PAGE_ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5] as const;
export function nextPageZoom(cur: number | undefined, ask: 'in' | 'out' | 'reset'): number {
  if (ask === 'reset') return 1;
  const z = cur ?? 1;
  if (ask === 'in') return PAGE_ZOOMS.find((s) => s > z + 0.001) ?? PAGE_ZOOMS[PAGE_ZOOMS.length - 1];
  return [...PAGE_ZOOMS].reverse().find((s) => s < z - 0.001) ?? PAGE_ZOOMS[0];
}

/** 保存截图's suggested file name: the page's title (cut short) and the time, `.png` (the shell makes it a safe name). */
export function screenshotName(title: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const when = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}.${p(at.getMinutes())}.${p(at.getSeconds())}`;
  const base = title.trim().slice(0, 60).trim() || 'screenshot';
  return `${base} ${when}.png`;
}

/** One row of the downloads bar, as the shell reports it (desktop/src/guest-tools.ts `desktop:guestDownload`). */
export interface DownloadRow {
  id: string;
  name: string;
  state: 'progress' | 'done' | 'failed' | 'cancelled';
  received: number;
  /** 0: the size is not known */
  total: number;
  /** where it was saved (only once done): what 打开 / 在文件夹中显示 hand back to the shell */
  path?: string;
  /** a program or script (guest-tools.ts isRisky): the shell will not open it, only show it in its folder */
  risky?: boolean;
  /** cancelled by the shell: the page started too many downloads at once */
  blocked?: boolean;
}
const STATES = new Set(['progress', 'done', 'failed', 'cancelled']);
export const MAX_DOWNLOADS = 5;

/** A download event into the bar's list: a new one first, a known one updated in place; the latest few kept. */
export function applyDownload(list: readonly DownloadRow[], ev: DownloadRow): DownloadRow[] {
  if (!ev || typeof ev.id !== 'string' || typeof ev.name !== 'string' || !STATES.has(ev.state)) return [...list];
  const row: DownloadRow = { id: ev.id, name: ev.name, state: ev.state, received: Number(ev.received) || 0, total: Number(ev.total) || 0, ...(typeof ev.path === 'string' ? { path: ev.path } : {}), ...(ev.risky === true ? { risky: true } : {}), ...(ev.blocked === true ? { blocked: true } : {}) };
  const i = list.findIndex((d) => d.id === row.id);
  if (i >= 0) return list.map((d, j) => (j === i ? { ...d, ...row } : d));
  return [row, ...list].slice(0, MAX_DOWNLOADS);
}

export function downloadPercent(d: DownloadRow): number | null {
  if (!(d.total > 0)) return null;
  return Math.min(100, Math.round((d.received / d.total) * 100));
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(1)} ${units[u]}`;
}

/**
 * Chromium's codes for a load the shell's file guard stopped (desktop/src/file-guard.ts): webRequest's cancel
 * (ERR_BLOCKED_BY_CLIENT), access denied, and the file: handler's empty 403 (ERR_HTTP_RESPONSE_CODE_FAILURE).
 */
const GUARD_CODES = new Set([-20, -10, -379]);

/**
 * What a failed top-frame load says (round 2): -3 (aborted — replaced by another load, a download) nothing; a local
 * page the guard refused 「这个本地页面没有打开」; anything else, a local page that is missing included, the normal
 * load-failure message.
 */
export function loadFailure(f: { errorCode?: number; validatedURL?: string }): 'none' | 'local-refused' | 'failed' {
  if (f.errorCode === -3) return 'none';
  if (/^file:/i.test(f.validatedURL ?? '') && GUARD_CODES.has(f.errorCode ?? 0)) return 'local-refused';
  return 'failed';
}
