// 录下 Claude 的操作 (stage E3 / B5): with the ⋯ menu's switch on, the first browser action of a turn starts recording
// the conversation's tab (no countdown); the turn ending stops it; the video goes into the conversation's folder and
// its place into sessionMeta.browserRecordings, where the turn shows it as a chip.
import { useStore } from '@/store';
import { desktop } from '@/desktop';
import { uploadAttachment } from '@/model/attachments';
import { onRecorded, recordingTarget, startRecording, stopRecording } from '@/features/recording/recorder';
import { agentTab, guestOf } from './state';

export const RECORD_KEY = 'browser.recordActions';
const PREFIX = 'browser:';

/** After a browser action of `sid`: start recording its tab if the switch is on and nothing records yet. */
export async function maybeRecordActions(sid: string): Promise<void> {
  if (!sid || useStore.getState().settings[RECORD_KEY] !== true || !desktop?.chooseCapture || recordingTarget()) return;
  const t = agentTab(sid);
  const el = t && guestOf(t.id);
  if (!el) return;
  let wc: number;
  try { wc = el.getWebContentsId(); } catch { return; /* not attached yet */ }
  const pick = { kind: 'guest' as const, webContentsId: wc };
  if (!(await desktop.chooseCapture(pick).catch(() => false))) return;
  await startRecording(PREFIX + sid, pick, { countdown: false });
}

/** Installed with the browser host: stop at the end of the turn, keep the video. */
export function installRecordActions(): () => void {
  const offStore = useStore.subscribe((s) => {
    const target = recordingTarget();
    if (!target?.startsWith(PREFIX)) return;
    const st = s.open[target.slice(PREFIX.length)]?.state;
    if (!st || st === 'idle' || st === 'closed' || st === 'history') stopRecording();
  });
  const offRec = onRecorded((r) => {
    if (!r.target.startsWith(PREFIX)) return;
    const sid = r.target.slice(PREFIX.length);
    void (async () => {
      const st = useStore.getState();
      try {
        const up = await uploadAttachment(sid, r.blob, `recordings/browser-${r.start}.${r.ext}`);
        const old = useStore.getState().sessionMeta[sid]?.browserRecordings ?? [];
        await st.setSessionMeta(sid, { browserRecordings: [...old, { path: up.path, start: r.start, end: r.start + r.ms }].slice(-20) });
      } catch (e: any) { st.toast(String(e?.message ?? e)); }
    })();
  });
  return () => { offStore(); offRec(); };
}
