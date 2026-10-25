// keyframes.test.ts
import { describe, expect, it } from 'vitest';
import { fmtDuration, frameDiff, pickKeyframes, pickRecorderMime, sampleTimes, type FrameSample } from './keyframes';

const flat = (v: number, n = 16) => new Uint8Array(n).fill(v);
const s = (t: number, v: number): FrameSample => ({ t, luma: flat(v) });

describe('frameDiff', () => {
  it('mean absolute difference, 0..255', () => {
    expect(frameDiff(flat(10), flat(10))).toBe(0);
    expect(frameDiff(flat(0), flat(255))).toBe(255);
    expect(frameDiff(new Uint8Array([0, 10]), new Uint8Array([10, 0]))).toBe(10);
  });
});

describe('sampleTimes', () => {
  it('every half second, at most 240, never past the end', () => {
    expect(sampleTimes(2)).toEqual([0, 0.5, 1, 1.5]);
    expect(sampleTimes(600)).toHaveLength(240);
    expect(sampleTimes(600)[239]).toBeLessThan(600);
    expect(sampleTimes(0)).toEqual([0]);
  });
});

describe('pickKeyframes', () => {
  it('the first frame, then the biggest changes, in time order', () => {
    const xs = [s(0, 0), s(0.5, 0), s(1, 100), s(1.5, 100), s(2, 100), s(2.5, 30), s(3, 30)];
    expect(pickKeyframes(xs)).toEqual([0, 1, 2.5]);
  });
  it('a still screen is its first frame, plus the last when it lasted 2 s or more', () => {
    const xs = Array.from({ length: 20 }, (_, i) => s(i * 0.5, 50));
    expect(pickKeyframes(xs)).toEqual([0, 9.5]);
    expect(pickKeyframes([s(0, 50), s(0.5, 50)])).toEqual([0]);
    expect(pickKeyframes([s(0, 50)])).toEqual([0]);
  });
  it('changes closer than minGap keep only the bigger one', () => {
    const xs = [s(0, 0), s(0.5, 40), s(1, 200), s(5, 0)];
    expect(pickKeyframes(xs, { minGap: 1 })).toEqual([0, 1, 5]);
  });
  it('never more than 12, always in time order', () => {
    const xs = Array.from({ length: 100 }, (_, i) => s(i * 2, i % 2 ? 255 : 0));
    const out = pickKeyframes(xs);
    expect(out).toHaveLength(12);
    expect(out[0]).toBe(0);
    expect([...out].sort((a, b) => a - b)).toEqual(out);
  });
});

describe('pickRecorderMime / fmtDuration', () => {
  it('mp4 when the recorder can, else webm', () => {
    expect(pickRecorderMime((m) => m.startsWith('video/mp4'))).toEqual({ mime: 'video/mp4;codecs=avc1', ext: 'mp4' });
    expect(pickRecorderMime((m) => m === 'video/webm;codecs=vp8')).toEqual({ mime: 'video/webm;codecs=vp8', ext: 'webm' });
    expect(pickRecorderMime(() => false)).toEqual({ mime: 'video/webm', ext: 'webm' });
  });
  it('m:ss', () => {
    expect(fmtDuration(13_400)).toBe('0:13');
    expect(fmtDuration(75_000)).toBe('1:15');
    expect(fmtDuration(3_600_000)).toBe('60:00');
  });
});
