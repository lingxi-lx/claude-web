import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/ui/icons';
import { imeComposing } from '@/ui/ime';
import { tr } from '@/i18n';
import { guestElOf, guestOf } from './state';

/**
 * Ctrl/Cmd+F in the built-in browser (stage B task 3): find in a tab's page with the <webview>'s own find
 * (`findInPage` — Chromium highlights and scrolls; the count comes back as `found-in-page`). Opened by the panel
 * (BrowserPanel.tsx: the keys in the panel itself, or from the page via the shell); `focusKey` changes each time it is
 * asked for again, which puts the focus back in the field. Closing it clears the highlights.
 */
export function FindBar({ tabId, focusKey, onClose }: { tabId: string; focusKey: number; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ cur: number; n: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusKey]);
  useEffect(() => {
    const el = guestElOf(tabId);
    if (!el) return;
    const on = (e: Event) => {
      const r = (e as unknown as { result?: { activeMatchOrdinal?: number; matches?: number } }).result;
      if (r) setRes({ cur: r.activeMatchOrdinal ?? 0, n: r.matches ?? 0 });
    };
    el.addEventListener('found-in-page', on);
    return () => {
      el.removeEventListener('found-in-page', on);
      try { guestOf(tabId)?.stopFindInPage?.('clearSelection'); } catch { /* the page went away */ }
    };
  }, [tabId]);

  /** `findNext` true starts a new search (the text changed); false moves to the next / previous hit of the same one. */
  const find = (text: string, o: { forward?: boolean; findNext: boolean }) => {
    const el = guestOf(tabId);
    try {
      if (!text) { el?.stopFindInPage?.('clearSelection'); setRes(null); return; }
      el?.findInPage?.(text, o);
    } catch { /* not attached */ }
  };
  const step = (forward: boolean) => { if (q) find(q, { forward, findNext: false }); };

  return (
    <div className="bw-find" data-id="find" role="search">
      <input
        ref={input}
        value={q}
        spellCheck={false}
        data-id="find-input"
        placeholder={tr('在页面中查找…')}
        aria-label={tr('在页面中查找')}
        onChange={(e) => { setQ(e.target.value); find(e.target.value, { findNext: true }); }}
        onKeyDown={(e) => {
          if (imeComposing(e.nativeEvent)) return;
          if (e.key === 'Enter') { e.preventDefault(); step(!e.shiftKey); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        }}
      />
      <span className="cnt" data-id="find-count" aria-live="polite">{res && q ? (res.n ? `${res.cur} / ${res.n}` : tr('无结果')) : ''}</span>
      <button className="icon-btn xs" title={tr('上一个 (Shift+Enter)')} aria-label={tr('上一个')} disabled={!q} onClick={() => step(false)}><Icon name="chevronUp" size={14} /></button>
      <button className="icon-btn xs" title={tr('下一个 (Enter)')} aria-label={tr('下一个')} disabled={!q} onClick={() => step(true)}><Icon name="chevronDown" size={14} /></button>
      <button className="icon-btn xs" title={tr('关闭 (Esc)')} aria-label={tr('关闭')} onClick={onClose}><Icon name="close" size={13} /></button>
    </div>
  );
}
