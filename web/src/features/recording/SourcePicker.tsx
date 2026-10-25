// 录屏 → what to record (spec E3): our own picker — whole screens, windows (never this app's own), and the built-in
// browser's tabs. Choosing tells the desktop shell (it hands exactly that to the next getDisplayMedia), then records.
import { useEffect, useRef, useState } from 'react';
import { desktop } from '@/desktop';
import { tr } from '@/i18n';
import { imeComposing } from '@/ui/ime';
import { guestOf, useBrowser } from '@/features/browser/state';
import { cancelRecording, closePicker, startRecording, useRecording, type CapturePick } from './recorder';

type Source = { id: string; name: string; kind: 'screen' | 'window'; thumb: string };

export function SourcePicker() {
  const phase = useRecording((s) => s.phase);
  const target = useRecording((s) => s.target);
  const left = useRecording((s) => s.left);
  if (phase === 'countdown') return <Countdown left={left ?? 3} />;
  if (phase !== 'picking' || !target) return null;
  return <PickerDialog target={target} />;
}

function Countdown({ left }: { left: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !imeComposing(e)) { e.preventDefault(); cancelRecording(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);
  return <div className="rec-countdown" role="status" aria-live="assertive" aria-label={tr('{n} 秒后开始录屏', { n: left })}>{left}</div>;
}

function PickerDialog({ target }: { target: string }) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const tabs = useBrowser((s) => s.tabs);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    desktop?.captureSources?.().then((l) => { if (live) setSources(l); }).catch(() => { if (live) setSources([]); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [sources === null]);
  const choose = async (pick: CapturePick) => {
    const ok = await desktop?.chooseCapture?.(pick).catch(() => false);
    closePicker();
    if (ok) void startRecording(target, pick);
  };
  const guests = tabs.flatMap((t) => {
    const el = guestOf(t.id);
    if (!el) return [];
    try { return [{ tab: t, wc: el.getWebContentsId() }]; } catch { return []; }
  });
  const screens = (sources ?? []).filter((s) => s.kind === 'screen');
  const windows = (sources ?? []).filter((s) => s.kind === 'window');
  const grid = (list: Source[]) => (
    <div className="rec-grid">
      {list.map((s) => (
        <button key={s.id} className="rec-src" data-src={s.id} onClick={() => void choose({ kind: 'source', id: s.id })}>
          <img src={s.thumb} alt="" />
          <span>{s.name}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div className="modal-bg dialog-bg" onMouseDown={(e) => e.target === e.currentTarget && closePicker()} onKeyDown={(e) => { if (e.key === 'Escape' && !imeComposing(e.nativeEvent)) { e.stopPropagation(); closePicker(); } }}>
      <div ref={box} className="modal rec-picker" role="dialog" aria-modal="true" aria-label={tr('录屏')} data-act="rec-picker">
        <h3>{tr('录屏')}</h3>
        {sources === null && <div className="sub">{tr('加载中…')}</div>}
        {screens.length > 0 && <><div className="rec-h">{tr('整个屏幕')}</div>{grid(screens)}</>}
        {windows.length > 0 && <><div className="rec-h">{tr('窗口')}</div>{grid(windows)}</>}
        {guests.length > 0 && (
          <>
            <div className="rec-h">{tr('内置浏览器的标签')}</div>
            <div className="rec-tabs">
              {guests.map(({ tab, wc }) => (
                <button key={tab.id} className="rec-tab" onClick={() => void choose({ kind: 'guest', webContentsId: wc })}>{tab.title || tab.url}</button>
              ))}
            </div>
          </>
        )}
        <div className="row-btns">
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={closePicker}>{tr('取消')}</button>
        </div>
      </div>
    </div>
  );
}
