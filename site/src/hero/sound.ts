// The café's sounds, synthesised (no audio files): the till's "ding" (the same note as the app's Cafe.tsx) and soft
// key ticks, faster the more guests type. Off until the visitor turns it on.
import type { World } from './engine';

export function tickInterval(busy: number): number {
  return busy <= 0 ? Infinity : Math.round(320 / Math.sqrt(busy));
}

export class Sound {
  on = false;
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private next = 0;
  private dinged = -1;

  toggle(): boolean {
    this.on = !this.on;
    if (this.on) {
      try { this.ctx ??= new AudioContext(); void this.ctx.resume(); } catch { this.on = false; }
      this.dinged = -1;
    }
    return this.on;
  }

  private ding() {
    const a = this.ctx!;
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 1568;
    g.gain.setValueAtTime(0.08, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.35);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + 0.36);
  }

  private tick() {
    const a = this.ctx!;
    if (!this.noise) {
      this.noise = a.createBuffer(1, Math.round(a.sampleRate * 0.03), a.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    }
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = this.noise;
    f.type = 'bandpass';
    f.frequency.value = 2200 + Math.random() * 800;
    g.gain.value = 0.025;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  }

  frame(w: World, nowMs: number) {
    if (!this.on || !this.ctx) return;
    const last = w.dings.at(-1) ?? 0;
    if (this.dinged < 0) this.dinged = last;
    else if (last > this.dinged) { this.dinged = last; this.ding(); }
    if (nowMs < this.next) return;
    const busy = w.actors.filter((a) => a.screen === 'code').length;
    if (busy) this.tick();
    const gap = tickInterval(busy);
    this.next = nowMs + (gap === Infinity ? 500 : gap * (0.6 + Math.random() * 0.8));
  }
}
