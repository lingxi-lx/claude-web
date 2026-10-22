import { describe, expect, it } from 'vitest';
import { CRAWLER, profileOf, tierOf, type TierEnv } from './tier';

const desk: TierEnv = { reducedMotion: false, canvas: true, crawler: false, finePointer: true, cores: 8, webgl2: true, renderer: 'ANGLE (NVIDIA GeForce RTX 3060)' };

describe('tiers', () => {
  it('T0: a desktop with a mouse, more than 4 cores and a real GPU', () => {
    expect(tierOf(desk)).toBe('T0');
  });
  it('T1: fewer cores, no WebGL2, a software GPU, or a phone', () => {
    expect(tierOf({ ...desk, cores: 4 })).toBe('T1');
    expect(tierOf({ ...desk, webgl2: false })).toBe('T1');
    expect(tierOf({ ...desk, renderer: 'Google SwiftShader' })).toBe('T1');
    expect(tierOf({ ...desk, finePointer: false })).toBe('T1');
  });
  it('T2: reduced motion, no canvas, crawlers', () => {
    expect(tierOf({ ...desk, reducedMotion: true })).toBe('T2');
    expect(tierOf({ ...desk, canvas: false })).toBe('T2');
    expect(tierOf({ ...desk, crawler: true })).toBe('T2');
  });
  it('what each tier does', () => {
    expect(profileOf('T0', true)).toEqual({ tier: 'T0', live: true, post: true, parallax: true, maxFps: 60, tapLock: false });
    expect(profileOf('T1', true)).toEqual({ tier: 'T1', live: true, post: false, parallax: true, maxFps: 60, tapLock: false });
    expect(profileOf('T1', false)).toEqual({ tier: 'T1', live: true, post: false, parallax: false, maxFps: 24, tapLock: true });
    expect(profileOf('T2', true).live).toBe(false);
  });
  it('knows the usual crawlers', () => {
    expect(CRAWLER.test('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(CRAWLER.test('facebookexternalhit/1.1')).toBe(true);
    expect(CRAWLER.test('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')).toBe(false);
  });
});
