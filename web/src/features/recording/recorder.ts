// 录屏 (spec E3): one recording at a time for the whole window. The source was already chosen in our picker (the
// desktop shell hands exactly it to the next getDisplayMedia); here: a 3 s countdown, MediaRecorder, the red dot's
// clock, and the finished video handed to whichever composer (or the built-in browser) started it.
import { create } from 'zustand';
import { useStore } from '@/store';
import { tr } from '@/i18n';
import { pickRecorderMime } from './keyframes';

export type CapturePick = { kind: 'source'; id: string } | { kind: 'guest'; webContentsId: number };
export type RecState = { phase: 'idle' | 'picking' | 'countdown' | 'recording'; startedAt?: number; left?: number; target?: string };
export interface PendingRecording { id: string; target: string; blob: Blob; ext: 'mp4' | 'webm'; ms: number; start: number }

/** 10 minutes, or just under the 200 MB attachment limit */
const MAX_MS = 10 * 60_000;
const MAX_BYTES = 190 * 1024 * 1024;

export const useRecording = create<RecState>(() => ({ phase: 'idle' }));

const listeners = new Set<(r: PendingRecording) => void>();
export function onRecorded(cb: (r: PendingRecording) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

let cur: { rec: MediaRecorder; stream: MediaStream; timer: ReturnType<typeof setTimeout> } | null = null;
let cancelCountdown: (() => void) | null = null;

/** The picker is open for this composer (SourcePicker reads it). */
export function openPicker(target: string) {
  if (useRecording.getState().phase !== 'idle') return;
  useRecording.setState({ phase: 'picking', target });
}
export function closePicker() {
  if (useRecording.getState().phase === 'picking') useRecording.setState({ phase: 'idle', target: undefined });
}

function countdown(): Promise<boolean> {
  return new Promise((resolve) => {
    let left = 3;
    useRecording.setState({ phase: 'countdown', left });
    const t = setInterval(() => {
      left--;
      if (left <= 0) { clearInterval(t); cancelCountdown = null; resolve(true); return; }
      useRecording.setState({ left });
    }, 1000);
    cancelCountdown = () => { clearInterval(t); cancelCountdown = null; resolve(false); };
  });
}

/** Esc during the countdown */
export function cancelRecording() {
  if (cancelCountdown) { cancelCountdown(); useRecording.setState({ phase: 'idle', target: undefined, left: undefined }); }
}

export async function startRecording(target: string, _pick: CapturePick, o: { countdown?: boolean } = {}): Promise<void> {
  if (cur) return;
  try {
    if (o.countdown !== false && !(await countdown())) return;
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    const { mime, ext } = pickRecorderMime((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    let bytes = 0;
    const start = Date.now();
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data);
      bytes += e.data.size;
      if (bytes >= MAX_BYTES) stopRecording();
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (cur) clearTimeout(cur.timer);
      cur = null;
      useRecording.setState({ phase: 'idle', startedAt: undefined, target: undefined, left: undefined });
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      if (!blob.size) return;
      const r: PendingRecording = { id: `rec-${start}`, target, blob, ext, ms: Date.now() - start, start };
      for (const l of [...listeners]) l(r);
    };
    // the user stopped sharing from the system (or the tab went away)
    stream.getVideoTracks().forEach((t) => t.addEventListener('ended', () => stopRecording()));
    cur = { rec, stream, timer: setTimeout(() => stopRecording(), MAX_MS) };
    rec.start(1000);
    useRecording.setState({ phase: 'recording', startedAt: start, target, left: undefined });
  } catch (e: any) {
    cur = null;
    useRecording.setState({ phase: 'idle', startedAt: undefined, target: undefined, left: undefined });
    useStore.getState().toast(tr('没能开始录屏：{msg}', { msg: String(e?.message ?? e) }));
  }
}

export function stopRecording(): void {
  if (!cur) return;
  try { if (cur.rec.state !== 'inactive') cur.rec.stop(); } catch { /* already stopped */ }
}

/** what is being recorded right now (the built-in browser stops its own when the turn ends) */
export const recordingTarget = () => (cur ? useRecording.getState().target : undefined);
