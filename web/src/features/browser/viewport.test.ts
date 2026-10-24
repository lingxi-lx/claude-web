import { describe, expect, it } from 'vitest';
import { VIEWPORTS, VIEWPORT_IDS, fitScale, viewportOf } from './viewport';

describe('viewport presets', () => {
  it('auto lets the page fill the panel; the others are the sizes of the devices', () => {
    expect(VIEWPORTS.auto).toBeNull();
    expect(VIEWPORTS.phone).toEqual({ w: 390, h: 844, touch: true, mobile: true });
    expect(VIEWPORTS.tablet).toEqual({ w: 820, h: 1180, touch: true, mobile: true });
    expect(VIEWPORTS.desktop).toEqual({ w: 1440, h: 900, touch: false, mobile: false });
    expect(VIEWPORT_IDS).toEqual(['auto', 'phone', 'tablet', 'desktop']);
  });
  it('a tab without a choice, or with one this build does not know, is auto', () => {
    expect(viewportOf(undefined)).toBeNull();
    expect(viewportOf('auto')).toBeNull();
    expect(viewportOf('watch' as never)).toBeNull();
    expect(viewportOf('phone')).toBe(VIEWPORTS.phone);
  });
});

describe('fitScale', () => {
  it('a device that fits is drawn at its size, never bigger', () => {
    expect(fitScale({ w: 400, h: 900 }, { w: 390, h: 844 })).toBe(1);
    expect(fitScale({ w: 4000, h: 4000 }, { w: 390, h: 844 })).toBe(1);
  });
  it('one that does not is scaled down by the side that is short', () => {
    const s = fitScale({ w: 300, h: 600 }, { w: 390, h: 844 });
    expect(s).toBeLessThan(1);
    expect(s).toBeCloseTo(600 / 844, 5);
    expect(fitScale({ w: 720, h: 2000 }, { w: 1440, h: 900 })).toBeCloseTo(0.5, 5);
  });
  it('a panel with no size yet (hidden) does not make the page vanish', () => {
    expect(fitScale({ w: 0, h: 0 }, { w: 390, h: 844 })).toBe(1);
    expect(fitScale({ w: 300, h: -1 }, { w: 390, h: 844 })).toBe(1);
  });
});
