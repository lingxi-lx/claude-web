// 录屏 (spec E3): which frames of a recording go to Claude as pictures, and the recorder format. Pure.

export interface FrameSample { t: number; luma: Uint8Array }

/** Mean absolute difference of two equally sized grey thumbnails, 0..255. */
export function frameDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

/** When to look at the video: every `step` seconds, never more than `max` looks, never at or past the end. */
export function sampleTimes(durationSec: number, step = 0.5, max = 240): number[] {
  if (!(durationSec > 0)) return [0];
  let s = step;
  if (durationSec / s > max) s = durationSec / max;
  const out: number[] = [];
  for (let i = 0; out.length < max; i++) {
    const t = Math.round(i * s * 1000) / 1000;
    if (t >= durationSec) break;
    out.push(t);
  }
  return out;
}

/** The first frame, then the biggest changes (at least `minGap` s apart), at most `max`, in time order. */
export function pickKeyframes(samples: readonly FrameSample[], o: { max?: number; minGap?: number; threshold?: number } = {}): number[] {
  const { max = 12, minGap = 1, threshold = 8 } = o;
  if (!samples.length) return [];
  const picked = [samples[0].t];
  const cands: { t: number; d: number }[] = [];
  for (let i = 1; i < samples.length; i++) {
    const d = frameDiff(samples[i - 1].luma, samples[i].luma);
    if (d >= threshold) cands.push({ t: samples[i].t, d });
  }
  cands.sort((a, b) => b.d - a.d || a.t - b.t);
  for (const c of cands) {
    if (picked.length >= max) break;
    if (picked.some((t) => Math.abs(t - c.t) < minGap)) continue;
    picked.push(c.t);
  }
  const last = samples[samples.length - 1];
  if (picked.length === 1 && last.t - samples[0].t >= 2) picked.push(last.t);
  return picked.sort((a, b) => a - b);
}

const MIMES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8'];

export function pickRecorderMime(isSupported: (m: string) => boolean): { mime: string; ext: 'mp4' | 'webm' } {
  for (const m of MIMES) if (isSupported(m)) return { mime: m, ext: m.startsWith('video/mp4') ? 'mp4' : 'webm' };
  return { mime: 'video/webm', ext: 'webm' };
}

/** m:ss */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
