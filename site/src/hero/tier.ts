// Three tiers of the hero (spec §7): T0 layered canvas + WebGL post, T1 layered canvas only (phones: no parallax,
// ≤ 24 fps, tap to lock), T2 the poster image. Pure: readTierEnv() gathers the facts in the browser.
export type Tier = 'T0' | 'T1' | 'T2';
export interface TierEnv { reducedMotion: boolean; canvas: boolean; crawler: boolean; finePointer: boolean; cores: number; webgl2: boolean; renderer: string }
export interface TierProfile { tier: Tier; live: boolean; post: boolean; parallax: boolean; maxFps: number; tapLock: boolean }

export const CRAWLER = /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|embedly|whatsapp|telegram|discord|preview/i;

export function tierOf(e: TierEnv): Tier {
  if (e.reducedMotion || !e.canvas || e.crawler) return 'T2';
  if (e.finePointer && e.cores > 4 && e.webgl2 && !/swiftshader/i.test(e.renderer)) return 'T0';
  return 'T1';
}

export function profileOf(tier: Tier, finePointer: boolean): TierProfile {
  if (tier === 'T2') return { tier, live: false, post: false, parallax: false, maxFps: 0, tapLock: false };
  if (tier === 'T0') return { tier, live: true, post: true, parallax: true, maxFps: 60, tapLock: false };
  return finePointer
    ? { tier, live: true, post: false, parallax: true, maxFps: 60, tapLock: false }
    : { tier, live: true, post: false, parallax: false, maxFps: 24, tapLock: true };
}

export function readTierEnv(): TierEnv {
  const mm = (q: string) => !!window.matchMedia?.(q).matches;
  const probe = document.createElement('canvas');
  let webgl2 = false, renderer = '';
  try {
    const gl = probe.getContext('webgl2');
    if (gl) {
      webgl2 = true;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* no WebGL */ }
  let canvas = false;
  try { canvas = !!document.createElement('canvas').getContext('2d'); } catch { /* none */ }
  return {
    reducedMotion: mm('(prefers-reduced-motion: reduce)'),
    canvas,
    crawler: CRAWLER.test(navigator.userAgent),
    finePointer: mm('(pointer: fine)') && mm('(hover: hover)'),
    cores: navigator.hardwareConcurrency || 2,
    webgl2,
    renderer,
  };
}
