// 录下 Claude 的操作 (stage B5): the recordings started during a turn, as chips at its end; a click plays the video in
// the built-in browser (the server's file endpoint, which allows media).
import { useStore } from '@/store';
import { tr } from '@/i18n';
import { Icon } from '@/ui/icons';
import { fileUrl } from '@/features/editor/preview';
import { showPanel } from '@/features/workbench/right-panel';
import { fmtDuration } from '@/features/recording/keyframes';
import { newTab } from './state';

const NONE: { path: string; start: number; end: number }[] = [];

export function TurnRecordings({ sessionId, start, end }: { sessionId: string; start: number; end: number }) {
  const all = useStore((s) => s.sessionMeta[sessionId]?.browserRecordings) ?? NONE;
  const mine = Number.isFinite(start) ? all.filter((r) => r.start >= start && r.start <= end) : [];
  if (!mine.length) return null;
  return (
    <div className="turn-recs">
      {mine.map((r) => (
        <button key={r.path} className="att-chip turn-rec" data-act="turn-recording" title={r.path}
          onClick={() => { newTab({ url: new URL(fileUrl(r.path), location.href).href, front: true }); showPanel('browser'); }}>
          <Icon name="monitor" size={12} /> {tr('录下的操作 · {d}', { d: fmtDuration(r.end - r.start) })}
        </button>
      ))}
    </div>
  );
}
