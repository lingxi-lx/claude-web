import { describe, expect, it } from 'vitest';
import { CLIPS, expectedMediaFiles, posterFile, videoFile } from './clips';
import { THEME_IDS } from './ids';

describe('the clip table', () => {
  it('has the ten themes in order, then describe', () => {
    expect(CLIPS.map((c) => c.id)).toEqual([...THEME_IDS, 'describe']);
    expect(CLIPS.filter((c) => !c.describe).every((c) => c.duration === 12 && c.palette === c.id)).toBe(true);
    const d = CLIPS[10];
    expect(d).toMatchObject({ id: 'describe', palette: 'metro', duration: 15, describe: true });
  });

  it('puts the markers inside each clip', () => {
    expect(CLIPS[0].markers).toEqual([{ at: 0, key: 'home' }, { at: 5, key: 'turn' }, { at: 10, key: 'waiting' }]);
    // 换上新主题 at 12 s: the recorded apply card lands at 11.6–12.1 s (scripts/record-themes.cjs logs it)
    expect(CLIPS[10].markers).toEqual([{ at: 0, key: 'describe' }, { at: 4, key: 'trial' }, { at: 12, key: 'apply' }]);
    for (const c of CLIPS) for (const m of c.markers) expect(m.at).toBeLessThan(c.duration);
  });

  it('names the files', () => {
    expect(videoFile('ink', 'zh', 'webm', false)).toBe('ink.zh.webm');
    expect(videoFile('ink', 'zh', 'mp4', true)).toBe('ink.zh-sm.mp4');
    expect(posterFile('describe', 'en')).toBe('describe.en.webp');
  });

  it('expects 110 files, each once', () => {
    const f = expectedMediaFiles();
    expect(f).toHaveLength(110);
    expect(new Set(f).size).toBe(110);
    expect(f).toEqual([...f].sort());
    expect(f).toContain('phosphor.en.webm');
    expect(f).toContain('describe.zh-sm.mp4');
    expect(f).toContain('ink.zh.webp');
  });
});
