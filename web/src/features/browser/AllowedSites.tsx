// 管理允许的网站… (stage B task 4): the sites where Claude's changes to a page (click, type, fill in) do not ask
// first. Entries are added from the permission card's 总是允许这个网站, and — in 「完全放开」 — by the server itself
// for every site the built-in browser works on (spec 14.4, last bullet), marked in ALLOWED_SITES_AUTO_KEY so the
// list can say so (the server's gate reads the same settings: server/src/web/site-gate.ts); here they are only
// listed and removed (on the server: web.allowedSites.remove, on the same write queue as its own adds).
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/store';
import { ws } from '@/ws/client';
import { Icon } from '@/ui/icons';
import { imeComposing } from '@/ui/ime';
import { trapTab } from '@/ui/focus-trap';
import { EMPTY, emptyText } from '@/ui/terms';
import { tr } from '@/i18n';

export const ALLOWED_SITES_KEY = 'web.browser.allowedSites';
/** The hosts 完全放开 put on the list by itself (a sibling of the plain list; site-gate.ts ALLOWED_SITES_AUTO_KEY). */
export const ALLOWED_SITES_AUTO_KEY = 'web.browser.allowedSitesAuto';

/** The stored list as host names: strings only, trimmed, each once (`*.example.com` = its subdomains too). */
export function readSites(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((s): s is string => typeof s === 'string').map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

/**
 * `site` off the list and its 完全放开 mark with it — done by the server in one step, so a site it adds by itself at
 * the same moment is not lost (a write-back of the whole list from here could drop it); the store takes its answer.
 */
export async function removeAllowedSite(site: string): Promise<void> {
  const r = await ws.request<{ sites: string[]; auto: string[] }>({ kind: 'web.allowedSites.remove', host: site });
  useStore.setState((st) => ({ settings: { ...st.settings, [ALLOWED_SITES_KEY]: r.sites, [ALLOWED_SITES_AUTO_KEY]: r.auto.length ? r.auto : undefined } }));
}

/** The rows: each site, the 完全放开 label on the ones it added, a remove button on every one. */
export function AllowedSitesList({ sites, auto, onRemove }: { sites: readonly string[]; auto: readonly string[]; onRemove: (site: string) => void }) {
  if (!sites.length) return <div className="empty">{emptyText(EMPTY.allowedSites)}</div>;
  const marked = new Set(auto);
  return (
    <ul className="bw-allowed-list">
      {sites.map((s) => (
        <li key={s} data-site={s} {...(marked.has(s) ? { 'data-auto': 'true' } : {})}>
          <span className="h" title={s}>{s}</span>
          {marked.has(s) && <span className="bw-allowed-auto">{tr('完全放开时自动加入')}</span>}
          <button type="button" className="icon-btn xs" title={tr('移除')} aria-label={tr('移除 {site}', { site: s })} onClick={() => onRemove(s)}><Icon name="close" size={13} /></button>
        </li>
      ))}
    </ul>
  );
}

/** The two keys as the server has them now (it adds sites by itself in 完全放开, after this window loaded its settings). */
async function freshSites(): Promise<void> {
  const s = await ws.request<Record<string, unknown>>({ kind: 'settings.get' });
  useStore.setState((st) => ({ settings: { ...st.settings, [ALLOWED_SITES_KEY]: s[ALLOWED_SITES_KEY], [ALLOWED_SITES_AUTO_KEY]: s[ALLOWED_SITES_AUTO_KEY] } }));
}

export function AllowedSites({ onClose }: { onClose: () => void }) {
  // the stored arrays themselves (stable references); cleaned below
  const stored = useStore((s) => s.settings[ALLOWED_SITES_KEY]);
  const storedAuto = useStore((s) => s.settings[ALLOWED_SITES_AUTO_KEY]);
  const toast = useStore((s) => s.toast);
  const sites = readSites(stored);
  const auto = readSites(storedAuto);
  const box = useRef<HTMLDivElement>(null);
  // 完成 takes the focus (not a remove button: an Enter right away must not take a site off)
  useEffect(() => { box.current?.querySelector<HTMLElement>('.actions .btn')?.focus({ preventScroll: true }); }, []);
  useEffect(() => { void freshSites().catch(() => {}); }, []);
  const remove = (site: string) => { removeAllowedSite(site).catch((e) => toast((e as Error).message)); };
  return createPortal(
    <div className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => { if (e.key === 'Escape' && !imeComposing(e.nativeEvent)) { e.stopPropagation(); onClose(); } else trapTab(e, box.current); }}>
      <div ref={box} className="modal dialog bw-allowed" role="dialog" aria-modal="true" aria-label={tr('允许的网站')} data-id="allowed-sites">
        <h3>{tr('允许的网站')}</h3>
        <p className="sub">{tr('Claude 在这些网站上点击、输入、填表时不再先问你；让它在页面里运行脚本仍然每次都问（完全放开时不问）。「*.」开头的包括它的子域名。')}</p>
        <p className="sub">{tr('完全放开时 Claude 打开或操作过的网站会自动加入这里。')}</p>
        <AllowedSitesList sites={sites} auto={auto} onRemove={remove} />
        <div className="actions">
          <button type="button" className="btn primary" onClick={onClose}>{tr('完成')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
