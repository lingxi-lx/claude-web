// A file Claude writes opens by itself when the turn ends (stage B task 2; the official desktop's 「Auto-open files
// Claude writes」): the last page / document / picture it wrote — a page in the built-in browser, the rest in the
// app's own preview. Pure but for `onTurnEndAutoOpen`, which the store calls with its own state (no import of the
// store here: it imports this).
import { parsePeerId } from '@shared';
import { walkTools, type Item } from '@/model/conversation';
import type { LayoutState, Tile } from '@/model/layout';
import { openUrl } from './state';

/** What opens: a page, a document, a picture (the preview shows these; code and data stay where they are). */
const PREVIEWABLE = /\.(html?|md|svg|pdf|png|jpe?g|gif|webp)$/i;
const PAGE = /\.html?$/i;
/** The tools that write a file, and where their input names it. */
const WRITERS: Record<string, string> = { Write: 'file_path', Edit: 'file_path', NotebookEdit: 'notebook_path' };
/** `\\host\share`, `//host/share`: opening one makes Windows connect to that machine (link-route.ts says why not). */
const UNC = /^[\\/]{2}/;
const ABSOLUTE = /^([a-zA-Z]:[\\/]|[\\/])/;

/**
 * The last file with a previewable suffix that this turn — everything after the last thing the user said — wrote
 * successfully (a sub-agent's writes count; a call that failed, was stopped, or never got its result does not).
 */
export function lastPreviewable(items: readonly Item[]): string | undefined {
  let from = items.length;
  while (from > 0) {
    const it = items[from - 1];
    if (it.kind === 'user' && !it.meta) break;
    from--;
  }
  let found: string | undefined;
  for (const { tool } of walkTools(items.slice(from))) {
    const key = WRITERS[tool.name];
    const path = key ? tool.input?.[key] : undefined;
    if (typeof path !== 'string' || !PREVIEWABLE.test(path)) continue;
    if (!tool.result || tool.result.isError || tool.stopped) continue;
    found = path;
  }
  return found;
}

/** `C:\a b\x.html` → `file:///C:/a%20b/x.html` (the drive as it is, every other part encoded). */
export function fileUrl(path: string): string {
  const parts = path.replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  return 'file:///' + parts.map((p, i) => (i === 0 && /^[a-zA-Z]:$/.test(p) ? p : encodeURIComponent(p))).join('/');
}

/** The pane whose front tab is this conversation, in the group being shown (store/external.ts `shownSessions`). */
export function paneShowing(layout: LayoutState, sessionId: string): string | undefined {
  const g = layout.groups.find((x) => x.id === layout.activeGroupId);
  for (const [paneId, p] of Object.entries(g?.panes ?? {})) {
    const t = p.tiles.find((x) => x.id === p.activeTileId) ?? p.tiles[0];
    if (t?.kind === 'chat' && t.sessionId === sessionId) return paneId;
  }
  return undefined;
}

/** One key per file however its path was spelled (slashes, a drive letter's case). */
const keyOf = (path: string) => path.replace(/\\/g, '/').toLowerCase();

export type AutoOpen = { to: 'browser'; path: string; url: string } | { to: 'doc'; path: string };

/**
 * What to open as a turn ends, or null. Nothing when `web.browser.openFiles` is off (`setting === false`), the turn
 * failed, the conversation is another machine's (its files are on that disk), it is not on screen in this window, on
 * a phone (it would take the conversation off the screen), or the file was already opened this way since the app
 * started. A page goes to the built-in browser in the desktop app (the web version's frame cannot show a file).
 */
export function planAutoOpen(o: {
  sessionId: string;
  items: readonly Item[];
  isError: boolean;
  setting: unknown;
  shown: boolean;
  desktop: boolean;
  mobile: boolean;
  cwd?: string;
  opened: ReadonlySet<string>;
}): AutoOpen | null {
  if (o.setting === false || o.isError || !o.shown || o.mobile || parsePeerId(o.sessionId)) return null;
  const raw = lastPreviewable(o.items);
  if (!raw || UNC.test(raw)) return null;
  let path = raw;
  if (!ABSOLUTE.test(raw)) {
    if (!o.cwd || UNC.test(o.cwd)) return null;
    path = `${o.cwd.replace(/\\/g, '/').replace(/\/+$/, '')}/${raw.replace(/\\/g, '/').replace(/^\.\//, '')}`;
  }
  if (o.opened.has(keyOf(path))) return null;
  return o.desktop && PAGE.test(path) ? { to: 'browser', path, url: fileUrl(path) } : { to: 'doc', path };
}

/** The files opened this way since the app started (one window's). */
const opened = new Set<string>();

/** What of the store this needs (passed in by the store itself). */
export interface AutoOpenStore {
  open: Record<string, { cwd?: string; conv: { items: Item[]; lastResult?: { isError: boolean } } } | undefined>;
  settings: Record<string, unknown>;
  layout: LayoutState;
  mobile: boolean;
  openTile(tile: Tile, mode?: 'replace' | 'tab', paneId?: string): void;
  dispatchLayout(a: { t: 'dock.show'; panel: 'browser' }): void;
}

/** What of the desktop shell this needs (`desktop` of '@/desktop'; undefined in the web version). */
export interface AutoOpenShell { allowFileOnce?(url: string): Promise<boolean> }

/**
 * The store's `onTurnEnd`: open what this turn wrote, if anything. A page: the right panel's 浏览器 (what
 * right-panel.ts `openInBrowser` does — it imports the store, so it is not imported here), once the shell has let
 * that one tab load that one file (desktop/src/file-guard.ts refuses every other file: load in the built-in browser —
 * a file:// page could otherwise read any file on the machine). A shell without the guard, or one that says no: the
 * doc preview, like anything else — a doc tab in the pane the conversation is in.
 */
export function onTurnEndAutoOpen(sessionId: string, st: AutoOpenStore, shell: AutoOpenShell | undefined): AutoOpen | null {
  const o = st.open[sessionId];
  if (!o) return null;
  const paneId = paneShowing(st.layout, sessionId);
  const plan = planAutoOpen({
    sessionId, items: o.conv.items, isError: !!o.conv.lastResult?.isError, setting: st.settings?.['web.browser.openFiles'],
    shown: !!paneId, desktop: !!shell?.allowFileOnce, mobile: st.mobile, cwd: o.cwd, opened,
  });
  if (!plan) return null;
  opened.add(keyOf(plan.path));
  const doc = () => st.openTile({ id: `d${Date.now().toString(36)}`, kind: 'doc', path: plan.path }, 'tab', paneId);
  if (plan.to === 'browser' && shell?.allowFileOnce) {
    void shell.allowFileOnce(plan.url).then((ok) => {
      if (!ok) return doc();
      openUrl(plan.url);
      st.dispatchLayout({ t: 'dock.show', panel: 'browser' });
    }, doc);
  } else doc();
  return plan;
}
