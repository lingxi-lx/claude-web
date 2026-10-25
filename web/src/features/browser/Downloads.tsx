import { useEffect } from 'react';
import { create } from 'zustand';
import { desktop } from '@/desktop';
import { useStore } from '@/store';
import { clsx } from '@/util';
import { Icon } from '@/ui/icons';
import { tr } from '@/i18n';
import { applyDownload, downloadPercent, fmtBytes, type DownloadRow } from './panel-logic';

/** The downloads of this window's built-in browser pages, newest first (the shell reports them: guest-tools.ts). */
export const useDownloads = create<{ list: DownloadRow[] }>(() => ({ list: [] }));
/** Rows the user closed: a download still going does not come back with its next report. */
const dismissed = new Set<string>();

function dismiss(id: string) {
  dismissed.add(id);
  useDownloads.setState((s) => ({ list: s.list.filter((d) => d.id !== id) }));
}

/** Listen to the shell's download reports while the panel is there (once per window: the panel never unmounts). */
export function useDownloadEvents(): void {
  useEffect(() => desktop?.onGuestDownload?.((ev) => {
    if (!ev || dismissed.has(ev.id)) return;
    useDownloads.setState((s) => ({ list: applyDownload(s.list, ev) }));
  }), []);
}

function status(d: DownloadRow): string {
  if (d.state === 'done' && d.risky) return tr('已下载 · {size} · 程序文件，只能在文件夹中查看', { size: fmtBytes(d.received || d.total) });
  if (d.state === 'done') return tr('已下载 · {size}', { size: fmtBytes(d.received || d.total) });
  if (d.state === 'failed') return tr('下载失败');
  if (d.state === 'cancelled' && d.blocked) return tr('网页一下要下载太多文件，已拦下');
  if (d.state === 'cancelled') return tr('已取消');
  const pct = downloadPercent(d);
  return pct === null ? fmtBytes(d.received) : `${pct}% · ${fmtBytes(d.received)} / ${fmtBytes(d.total)}`;
}

/**
 * The downloads bar at the foot of the browser panel: each download with its progress, and once it is saved (into
 * the Downloads folder) 打开 and 在文件夹中显示 — the shell opens only a file one of these downloads saved.
 */
export function DownloadsBar() {
  const list = useDownloads((s) => s.list);
  const toast = useStore((s) => s.toast);
  if (!list.length) return null;
  const open = (d: DownloadRow) => { if (d.path) void desktop?.openDownload?.(d.path).then((ok) => { if (!ok) toast(tr('打不开这个文件')); }); };
  const show = (d: DownloadRow) => { if (d.path) void desktop?.showDownload?.(d.path).then((ok) => { if (!ok) toast(tr('找不到这个文件')); }); };
  return (
    <div className="bw-dl" data-id="downloads" role="region" aria-label={tr('下载')}>
      {list.map((d) => {
        const pct = downloadPercent(d);
        return (
          <div key={d.id} className={clsx('bw-dl-row', d.state)} data-dl={d.id} data-state={d.state}>
            <span className="ic"><Icon name={d.state === 'failed' ? 'alert' : d.state === 'done' ? 'check' : 'arrowDown'} size={14} /></span>
            <span className="tx">
              {/* a program shows its whole name (wrapping, CSS), so `report.pdf      .exe` cannot pass for a PDF */}
              <span className="n" title={d.path ?? d.name} data-risky={d.risky ? '' : undefined}>{d.name}</span>
              <span className="s">{status(d)}</span>
              {d.state === 'progress' && <span className="bar" aria-hidden><i style={{ transform: `scaleX(${pct === null ? 0.3 : pct / 100})` }} className={clsx(pct === null && 'unknown')} /></span>}
            </span>
            {d.state === 'done' && d.path && (
              <>
                {!d.risky && <button className="btn sm" data-act="open" onClick={() => open(d)}>{tr('打开')}</button>}
                <button className="btn sm ghost" data-act="show" onClick={() => show(d)}>{tr('在文件夹中显示')}</button>
              </>
            )}
            <button className="icon-btn xs" data-act="dismiss" title={tr('从列表中移除')} aria-label={tr('从列表中移除')} onClick={() => dismiss(d.id)}><Icon name="close" size={12} /></button>
          </div>
        );
      })}
    </div>
  );
}
