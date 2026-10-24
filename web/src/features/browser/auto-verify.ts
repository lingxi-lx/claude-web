// 自动检查改动 (stage B task 8): after a turn that changed front-end files, the preview open in the built-in browser
// reloads; the console errors of that load and a picture of the page are kept, and when there are errors the turn
// gets a small strip 「预览有 N 个报错」 with 「让 Claude 修」 — which puts the errors and the picture into the
// conversation's input box (never sends). Pure but for `onTurnEndAutoVerify`, which the store calls with its own
// state and the guest pages (no import of the store or of guest.ts here: the store imports this).
import { create } from 'zustand';
import { parsePeerId, type BrowserConsoleEntry } from '@shared';
import { walkTools, type Item } from '@/model/conversation';
import type { PendingBundle } from '@/model/attachments';
import { groupTurns } from '@/model/turn';
import { tr } from '@/i18n';
import { consoleEntries, type PageHandle, type Picture } from './ops';
import { useBrowser, type BrowserTab } from './state';

export const AUTO_VERIFY_KEY = 'web.browser.autoVerify';
/** What counts as a front-end file. */
const FRONTEND = /\.(html?|css|scss|less|m?jsx?|tsx?|vue|svelte)$/i;
/** The tools that write a file, and where their input names it. */
const WRITERS: Record<string, string> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path' };
/** How long the reload is waited for. */
export const RELOAD_MS = 15_000;
/** What the page builds after `load` (and the errors it logs then) gets this long. */
export const AFTER_LOAD_MS = 800;
/** The most errors kept / put in the input box. */
export const MAX_ERRORS = 20;

/** The files this turn — everything after the last thing the user said — wrote successfully that are front-end files (each once). */
export function touchedFrontend(items: readonly Item[]): string[] {
  let from = items.length;
  while (from > 0) {
    const it = items[from - 1];
    if (it.kind === 'user' && !it.meta) break;
    from--;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { tool } of walkTools(items.slice(from))) {
    const key = WRITERS[tool.name];
    const path = key ? tool.input?.[key] : undefined;
    if (typeof path !== 'string' || !FRONTEND.test(path)) continue;
    if (!tool.result || tool.result.isError || tool.stopped) continue;
    const k = path.replace(/\\/g, '/').toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(path);
  }
  return out;
}

/** An http(s) address on this machine: localhost (and its subdomains), 127.x, [::1], 0.0.0.0. */
export function isLocalPreview(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h.endsWith('.localhost') || /^127\./.test(h) || h === '::1' || h === '0.0.0.0';
  } catch {
    return false;
  }
}

const originOf = (url: string): string => { try { return new URL(url).origin; } catch { return ''; } };

/**
 * The tab that shows this project's preview: an open page on this machine (localhost / 127.0.0.1) or at the address of
 * one of the project's `.claude/launch.json` servers (`launch`: their addresses, for `cwd`). The conversation's own
 * Agent tab first, then the tab in front, then the newest. A tab that failed to load, or is not a page yet, is not one.
 */
export function previewTabFor(cwd: string | undefined, tabs: readonly BrowserTab[], o: { launch?: readonly string[]; sessionId?: string; active?: string | null } = {}): BrowserTab | undefined {
  const launch = new Set((cwd ? o.launch ?? [] : []).map(originOf).filter(Boolean));
  const ok = tabs.filter((t) => t.src && !t.error && (isLocalPreview(t.url) || launch.has(originOf(t.url))));
  if (!ok.length) return undefined;
  return (o.sessionId ? ok.find((t) => t.agent === o.sessionId) : undefined) ?? ok.find((t) => t.id === o.active) ?? ok[ok.length - 1];
}

/**
 * Whether to check after this turn: the setting is not off, the turn did not fail, the conversation is this
 * machine's (a peer's files and servers are on that machine), and it changed front-end files. The files, or null.
 */
export function planAutoVerify(o: { sessionId: string; items: readonly Item[]; isError: boolean; setting: unknown }): string[] | null {
  if (o.setting === false || o.isError || parsePeerId(o.sessionId)) return null;
  const files = touchedFrontend(o.items);
  return files.length ? files : null;
}

/** The errors of the load that started at `since` (a console error, an uncaught exception, the browser's own error lines). */
export function errorsSince(raw: unknown, since: number): BrowserConsoleEntry[] {
  return consoleEntries(raw, true).filter((e) => e.level === 'error' && e.at >= since).slice(-MAX_ERRORS);
}

/** What 「让 Claude 修」 puts in the box: the errors as text (the picture goes with it). */
export function fixNote(v: { url: string; errors: readonly BrowserConsoleEntry[]; files: readonly string[] }): string {
  const lines = [
    tr('自动检查：改完前端文件后重新加载了预览 {url}，控制台有 {n} 个报错：', { url: v.url, n: v.errors.length }),
    '',
    ...v.errors.map((e, i) => `${i + 1}. ${e.text.replace(/\s+/g, ' ').slice(0, 600)}${e.url ? ` (${e.url})` : ''}`),
  ];
  if (v.files.length) lines.push('', tr('这一轮改过的文件：{files}', { files: v.files.slice(0, 12).join(', ') }));
  return lines.join('\n');
}

/** One conversation's check: running, or what it found (only kept when there are errors). `turn`: the turn it belongs to. */
export type VerifyState =
  | { status: 'checking'; turn: string; url: string }
  | { status: 'errors'; turn: string; url: string; errors: BrowserConsoleEntry[]; files: string[]; image?: Picture; at: number };

interface VerifyStore { bySession: Record<string, VerifyState | undefined> }
export const useVerify = create<VerifyStore>(() => ({ bySession: {} }));

const setVerify = (sessionId: string, v: VerifyState | undefined) =>
  useVerify.setState((s) => {
    const { [sessionId]: _old, ...rest } = s.bySession;
    return { bySession: v ? { ...rest, [sessionId]: v } : rest };
  });
export const dismissVerify = (sessionId: string): void => setVerify(sessionId, undefined);

/** The page of a tab, with a reload (guest.ts `pageOf` + the webview's reload). */
export type VerifyPage = Pick<PageHandle, 'debug' | 'capture' | 'url' | 'reload'>;

/** What of the store this needs (passed in by the store itself). */
export interface AutoVerifyStore {
  open: Record<string, { cwd?: string; conv: { items: Item[]; lastResult?: { isError: boolean } } } | undefined>;
  settings: Record<string, unknown>;
}
export interface AutoVerifyShell {
  /** the desktop shell can read a page's console (desktop.guestDebug); the web version cannot */
  canDebug: boolean;
  pageOf(tabId: string): VerifyPage;
  /** the addresses of the project's running launch.json servers (preview.list) */
  launchUrls?(cwd: string): Promise<string[]>;
}

const running = new Set<string>();

/**
 * One check of a page: the console is looked at once (it is kept from the first look on: desktop/src/guest-debug.ts),
 * the page reloads (RELOAD_MS at most), what it builds after `load` gets AFTER_LOAD_MS, then the errors logged since
 * the reload — and, when there are any, a picture. Throws when the page cannot be read (DevTools open, gone).
 */
export async function checkPage(page: VerifyPage): Promise<{ errors: BrowserConsoleEntry[]; image?: Picture }> {
  if (!page.reload) throw new Error('no reload');
  await page.debug('console');
  const since = Date.now();
  await page.reload(RELOAD_MS);
  await new Promise((r) => setTimeout(r, AFTER_LOAD_MS));
  const r = (await page.debug('console')) as { entries?: unknown } | undefined;
  const errors = errorsSince(r?.entries, since);
  if (!errors.length) return { errors };
  let image: Picture | undefined;
  try { image = await page.capture(); } catch { /* the errors are the point */ }
  return { errors, image };
}

/**
 * The store's `onTurnEnd`: when this turn changed front-end files and a preview is open, reload it, wait for it
 * (RELOAD_MS at most), and keep the errors logged since the reload with a picture. Nothing is sent anywhere.
 * Resolves with what it found (null: not checked) — the store does not wait for it.
 */
export async function onTurnEndAutoVerify(sessionId: string, st: AutoVerifyStore, shell: AutoVerifyShell): Promise<VerifyState | null> {
  const o = st.open[sessionId];
  if (!o || !shell.canDebug || running.has(sessionId)) return null;
  const files = planAutoVerify({ sessionId, items: o.conv.items, isError: !!o.conv.lastResult?.isError, setting: st.settings?.[AUTO_VERIFY_KEY] });
  if (!files) return null;
  const turn = groupTurns(o.conv.items).at(-1)?.id;
  if (!turn) return null;
  let launch: string[] = [];
  const b = useBrowser.getState();
  let tab = previewTabFor(o.cwd, b.tabs, { sessionId, active: b.active });
  if (!tab && o.cwd && shell.launchUrls) {
    try { launch = await shell.launchUrls(o.cwd); } catch { /* none known */ }
    const now = useBrowser.getState();
    tab = previewTabFor(o.cwd, now.tabs, { launch, sessionId, active: now.active });
  }
  if (!tab) return null;
  running.add(sessionId);
  setVerify(sessionId, { status: 'checking', turn, url: tab.url });
  try {
    const page = shell.pageOf(tab.id);
    const { errors, image } = await checkPage(page);
    if (!errors.length) { setVerify(sessionId, undefined); return null; }
    const v: VerifyState = { status: 'errors', turn, url: page.url() || tab.url, errors, files, image, at: Date.now() };
    setVerify(sessionId, v);
    return v;
  } catch {
    // the page went away, DevTools holds its protocol, …: no strip rather than a wrong one
    setVerify(sessionId, undefined);
    return null;
  } finally {
    running.delete(sessionId);
  }
}

/** 「让 Claude 修」: the errors and the picture into the conversation's input box (a bundle), and a line to send if the box is empty. */
export function fixWithClaude(sessionId: string, v: Extract<VerifyState, { status: 'errors' }>, st: {
  addComposerAttachment(sessionId: string, b: PendingBundle): void;
  setDraft(sessionId: string, d: string): void;
  open: Record<string, { draft?: string } | undefined>;
}): void {
  const text = fixNote(v);
  const name = tr('预览报错');
  if (v.image) {
    const url = `data:${v.image.mime};base64,${v.image.data}`;
    st.addComposerAttachment(sessionId, { id: `pv${Date.now().toString(36)}`, name, image: { mediaType: v.image.mime, data: v.image.data, url, name }, text });
  }
  const draft = st.open[sessionId]?.draft ?? '';
  if (!draft.trim()) st.setDraft(sessionId, v.image ? tr('预览有 {n} 个报错（附件里是报错和截图），请修好。', { n: v.errors.length }) : text);
}
