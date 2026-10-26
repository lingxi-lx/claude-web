// 管理允许的网站… (stage B task 4): the sites where Claude's changes to a page (click, type, fill in) do not ask
// first. Entries are added from the permission card's 总是允许这个网站 (the server's gate reads the same setting);
// here they are only listed and removed.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/store';
import { Icon } from '@/ui/icons';
import { imeComposing } from '@/ui/ime';
import { trapTab } from '@/ui/focus-trap';
import { EMPTY, emptyText } from '@/ui/terms';
import { tr } from '@/i18n';

export const ALLOWED_SITES_KEY = 'web.browser.allowedSites';

/** The stored list as host names: strings only, trimmed, each once (`*.example.com` = its subdomains too). */
export function readSites(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((s): s is string => typeof s === 'string').map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

export function AllowedSites({ onClose }: { onClose: () => void }) {
  // the stored array itself (a stable reference); cleaned below
  const stored = useStore((s) => s.settings[ALLOWED_SITES_KEY]);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);
  const sites = readSites(stored);
  const box = useRef<HTMLDivElement>(null);
  // 完成 takes the focus (not a remove button: an Enter right away must not take a site off)
  useEffect(() => { box.current?.querySelector<HTMLElement>('.actions .btn')?.focus({ preventScroll: true }); }, []);
  const remove = (site: string) => {
    void setSetting(ALLOWED_SITES_KEY, sites.filter((s) => s !== site)).catch((e) => toast((e as Error).message));
  };
  return createPortal(
    <div className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => { if (e.key === 'Escape' && !imeComposing(e.nativeEvent)) { e.stopPropagation(); onClose(); } else trapTab(e, box.current); }}>
      <div ref={box} className="modal dialog bw-allowed" role="dialog" aria-modal="true" aria-label={tr('允许的网站')} data-id="allowed-sites">
        <h3>{tr('允许的网站')}</h3>
        <p className="sub">{tr('Claude 在这些网站上点击、输入、填表时不再先问你；让它在页面里运行脚本仍然每次都问（完全放开时不问）。「*.」开头的包括它的子域名。')}</p>
        {sites.length ? (
          <ul className="bw-allowed-list">
            {sites.map((s) => (
              <li key={s} data-site={s}>
                <span className="h" title={s}>{s}</span>
                <button type="button" className="icon-btn xs" title={tr('移除')} aria-label={tr('移除 {site}', { site: s })} onClick={() => remove(s)}><Icon name="close" size={13} /></button>
              </li>
            ))}
          </ul>
        ) : <div className="empty">{emptyText(EMPTY.allowedSites)}</div>}
        <div className="actions">
          <button type="button" className="btn primary" onClick={onClose}>{tr('完成')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
