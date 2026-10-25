// 录屏: the red dot and its clock, top centre in the title bar row, while a recording runs; click to stop.
import { useEffect, useState } from 'react';
import { tr } from '@/i18n';
import { fmtDuration } from './keyframes';
import { stopRecording, useRecording } from './recorder';

export function RecordingIndicator() {
  const phase = useRecording((s) => s.phase);
  const startedAt = useRecording((s) => s.startedAt);
  const target = useRecording((s) => s.target);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);
  // the built-in browser's own recording of Claude's actions stops by itself at the end of the turn
  if (phase !== 'recording' || !startedAt || target?.startsWith('browser:')) return null;
  return (
    <button className="rec-dot" aria-label={tr('停止录屏')} title={tr('停止录屏')} onClick={stopRecording}>
      <span className="rec-red" aria-hidden />
      <span className="rec-time">{fmtDuration(now - startedAt)}</span>
    </button>
  );
}
