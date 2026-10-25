// 录屏 → the pictures sent with it (spec E3): sample the video, keep the frames where the screen changed most.
import { pickKeyframes, sampleTimes, type FrameSample } from './keyframes';

const once = (el: HTMLElement, ev: string, ms: number) =>
  new Promise<boolean>((resolve) => {
    const t = setTimeout(() => { el.removeEventListener(ev, h); resolve(false); }, ms);
    const h = () => { clearTimeout(t); el.removeEventListener(ev, h); resolve(true); };
    el.addEventListener(ev, h);
  });

async function seek(v: HTMLVideoElement, t: number): Promise<boolean> {
  const done = once(v, 'seeked', 2000);
  v.currentTime = t;
  return done;
}

export async function extractKeyframes(blob: Blob, ms: number): Promise<{ mediaType: 'image/jpeg'; data: string }[]> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  try {
    if (!(await once(v, 'loadedmetadata', 10_000))) throw new Error('video did not load');
    let d = v.duration;
    if (!Number.isFinite(d)) {
      // MediaRecorder's webm has no duration written: seek far to make the browser find the end
      const changed = once(v, 'durationchange', 3000);
      v.currentTime = 1e9;
      await changed;
      d = Number.isFinite(v.duration) ? v.duration : ms / 1000;
      await seek(v, 0);
    }
    const small = document.createElement('canvas');
    small.width = 64;
    small.height = 36;
    const sctx = small.getContext('2d', { willReadFrequently: true })!;
    const samples: FrameSample[] = [];
    for (const t of sampleTimes(d)) {
      if (!(await seek(v, t))) continue;
      sctx.drawImage(v, 0, 0, 64, 36);
      const px = sctx.getImageData(0, 0, 64, 36).data;
      const luma = new Uint8Array(64 * 36);
      for (let i = 0; i < luma.length; i++) luma[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
      samples.push({ t, luma });
    }
    const picked = pickKeyframes(samples);
    const w = v.videoWidth || 1280;
    const h = v.videoHeight || 720;
    const scale = Math.min(1, 1568 / Math.max(w, h));
    const big = document.createElement('canvas');
    big.width = Math.round(w * scale);
    big.height = Math.round(h * scale);
    const bctx = big.getContext('2d')!;
    const out: { mediaType: 'image/jpeg'; data: string }[] = [];
    for (const t of picked) {
      if (!(await seek(v, t))) continue;
      bctx.drawImage(v, 0, 0, big.width, big.height);
      out.push({ mediaType: 'image/jpeg', data: big.toDataURL('image/jpeg', 0.8).split(',')[1] ?? '' });
    }
    return out.filter((x) => x.data);
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}
