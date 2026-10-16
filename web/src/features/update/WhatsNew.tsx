// 更新内容 (spec 2026-10-16 pages §4; the official app's What's new): the app's own changelog, newest versions, in the
// interface language. Opens by itself once after the app was updated (not on a fresh install), and from 命令面板 /
// 设置 → 应用更新 any time.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useStore } from '@/store';
import { ws } from '@/ws/client';
import { getLocale, tr } from '@/i18n';
import { Markdown } from '@/features/chat/Markdown';

const SEEN_KEY = 'ui.lastSeenVersion';
const useWhatsNew = create<{ open: boolean }>(() => ({ open: false }));

export function openWhatsNew(): void {
  useWhatsNew.setState({ open: true });
}

/** At startup, once settings are in: first run → remember the version quietly; a newer version → show what changed. */
export function useWhatsNewOnUpdate(): void {
  const loaded = useStore((s) => s.metaLoaded);
  useEffect(() => {
    if (!loaded) return;
    let live = true;
    ws.request<{ version: string }>({ kind: 'app.changelog', lang: getLocale() }).then((r) => {
      if (!live || !r?.version) return;
      const st = useStore.getState();
      const seen = st.settings[SEEN_KEY];
      if (seen === r.version) return;
      void st.setSetting(SEEN_KEY, r.version);
      if (typeof seen === 'string' && seen) openWhatsNew();
    }).catch(() => {});
    return () => { live = false; };
  }, [loaded]);
}

export function WhatsNewModal() {
  const open = useWhatsNew((s) => s.open);
  if (!open) return null;
  return <Sheet />;
}

function Sheet() {
  const box = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState<{ markdown: string; version: string } | null>(null);
  const close = () => useWhatsNew.setState({ open: false });
  useEffect(() => {
    ws.request<{ markdown: string; version: string }>({ kind: 'app.changelog', lang: getLocale() }).then(setLog).catch(() => setLog({ markdown: '', version: '' }));
  }, []);
  useLayoutEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus({ preventScroll: true });
    return () => { if (back && back !== document.body && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true }); };
  }, []);
  return (
    <div className="modal-bg shortcuts-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={box} className="modal wide whats-new" tabIndex={-1} role="dialog" aria-modal="true" aria-label={tr('更新内容')}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
        <h3>{tr('更新内容')}{log?.version ? <span className="sub"> · v{log.version}</span> : null}</h3>
        <div className="wn-body">
          {!log ? <div className="sub">{tr('加载中…')}</div> : log.markdown ? <Markdown text={log.markdown} /> : <div className="sub">{tr('没找到更新日志')}</div>}
        </div>
        <div className="actions"><button className="btn" onClick={close}>{tr('关闭')}</button></div>
      </div>
    </div>
  );
}
