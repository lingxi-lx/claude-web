import { describe, expect, it } from 'vitest';
import { revealRadius, showcaseKey, timeAfterDrag, timeOnTimeline } from './input';

describe('keys', () => {
  it('← → wrap over all clips', () => {
    expect(showcaseKey('ArrowRight', 0, 11)).toEqual({ kind: 'go', index: 1 });
    expect(showcaseKey('ArrowRight', 10, 11)).toEqual({ kind: 'go', index: 0 });
    expect(showcaseKey('ArrowLeft', 0, 11)).toEqual({ kind: 'go', index: 10 });
  });
  it('1–9 and 0 pick the first ten', () => {
    expect(showcaseKey('1', 5, 11)).toEqual({ kind: 'go', index: 0 });
    expect(showcaseKey('9', 5, 11)).toEqual({ kind: 'go', index: 8 });
    expect(showcaseKey('0', 5, 11)).toEqual({ kind: 'go', index: 9 });
    expect(showcaseKey('0', 0, 5)).toBeNull();
  });
  it('space pauses; other keys are not ours', () => {
    expect(showcaseKey(' ', 0, 11)).toEqual({ kind: 'toggle' });
    expect(showcaseKey('d', 0, 11)).toBeNull();
    expect(showcaseKey('Enter', 0, 11)).toBeNull();
  });
});

describe('scrubbing', () => {
  it('maps the timeline to time, clamped short of the end', () => {
    expect(timeOnTimeline(150, 100, 200, 12)).toBeCloseTo(3);
    expect(timeOnTimeline(50, 100, 200, 12)).toBe(0);
    expect(timeOnTimeline(999, 100, 200, 12)).toBeCloseTo(11.96);
    expect(timeOnTimeline(150, 100, 0, 12)).toBe(0);
  });
  it('a drag across the whole picture is the whole clip', () => {
    expect(timeAfterDrag(6, 100, 400, 12)).toBeCloseTo(9);
    expect(timeAfterDrag(6, -1000, 400, 12)).toBe(0);
    expect(timeAfterDrag(6, 50, 0, 12)).toBe(6);
  });
});

describe('the reveal', () => {
  it('reaches the farthest corner, from inside or outside', () => {
    expect(revealRadius(0, 0, 100, 50)).toBeCloseTo(111.803, 2);
    expect(revealRadius(50, 25, 100, 50)).toBeCloseTo(55.902, 2);
    expect(revealRadius(50, 80, 100, 50)).toBeCloseTo(94.34, 1);
  });
});
