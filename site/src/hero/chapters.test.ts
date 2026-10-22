import { describe, expect, it } from 'vitest';
import { buildMap, onPage, sceneSize } from './engine';
import { EPOCH, snapshotAt } from './demo';
import { anchorFor, cameraView, CHAPTERS, chapterById, easeView, HERO_LOOK } from './chapters';

const map = buildMap(snapshotAt(31_000), EPOCH + 31_000);
const sz = sceneSize(map);

describe('chapters', () => {
  it('are the seven of copy.ts, in order', () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual(['agents', 'turns', 'permission', 'review', 'checkout', 'elsewhere', 'gateway']);
    expect(chapterById('review')?.focus).toBe('tests');
    expect(chapterById('nope')).toBeUndefined();
  });
  it('look at points inside the room', () => {
    for (const c of [...CHAPTERS.map((x) => x.look), HERO_LOOK]) {
      expect(c.u).toBeGreaterThanOrEqual(0);
      expect(c.u).toBeLessThanOrEqual(map.cols);
      expect(c.v).toBeGreaterThanOrEqual(0);
      expect(c.v).toBeLessThanOrEqual(map.rows);
      expect(c.zoom).toBeGreaterThan(0.5);
      expect(c.zoom).toBeLessThan(4);
    }
  });
  it('the camera puts the point at the anchor and covers the stage', () => {
    const a = anchorFor(1440);
    for (const c of CHAPTERS) {
      const v = cameraView(c.look, sz, 1440, 900, a);
      const p = onPage(v, sz, c.look.u, c.look.v, c.look.h ?? 0);
      expect(Math.abs(p.x - a.x * 1440)).toBeLessThan(0.5);
      expect(Math.abs(p.y - a.y * 900)).toBeLessThan(0.5);
      expect(sz.w * v.scale).toBeGreaterThanOrEqual(1440);
    }
  });
  it('phones look at the middle, desktops right of the copy', () => {
    expect(anchorFor(390).x).toBe(0.5);
    expect(anchorFor(1440).x).toBeGreaterThan(0.6);
  });
  it('eases from one view to the next', () => {
    const a = { scale: 1, x: 0, y: 0 }, b = { scale: 3, x: 100, y: -50 };
    expect(easeView(a, b, 0)).toEqual(a);
    expect(easeView(a, b, 1)).toEqual(b);
    expect(easeView(a, b, 0.5).x).toBeGreaterThan(50);
    expect(easeView(a, b, 2)).toEqual(b);
  });
});
