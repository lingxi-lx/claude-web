import { describe, expect, it } from 'vitest';
import { isAppRelease, mb, siteData, type GhRelease } from './releases';

const asset = (name: string, size = 100) => ({ name, size, browser_download_url: `https://example.test/${name}` });
const rel = (tag: string, at: string, extra: Partial<GhRelease> = {}): GhRelease => ({
  tag_name: tag, draft: false, prerelease: false, published_at: at, html_url: `https://example.test/tag/${tag}`, assets: [], ...extra,
});

const LIST: GhRelease[] = [
  rel('engine-v2.8.4-cw.5', '2026-10-22T00:00:00Z'),
  rel('site-media', '2026-10-22T01:00:00Z', { prerelease: true }),
  rel('v0.4.0', '2026-10-23T00:00:00Z', { draft: true }),
  rel('v0.3.0', '2026-10-21T08:00:00Z'),
  rel('v0.3.1', '2026-10-21T15:38:12Z', {
    assets: [
      asset('ClaudeWeb-0.3.1-win-x64.exe', 231908768),
      asset('ClaudeWeb-0.3.1-win-x64.exe.blockmap'),
      asset('ClaudeWeb-0.3.1-portable.exe', 231679920),
      asset('ClaudeWeb-0.3.1-mac-arm64.dmg', 270214749),
      asset('ClaudeWeb-0.3.1-mac-arm64.zip'),
      asset('latest.yml'),
    ],
  }),
];

describe('siteData', () => {
  it('takes the newest published app release (v1.2.3 tags only)', () => {
    const d = siteData(LIST, 42, '2026-10-22T00:00:00Z');
    expect(d.release?.version).toBe('0.3.1');
    expect(d.release?.date).toBe('2026-10-21');
    expect(d.release?.url).toBe('https://example.test/tag/v0.3.1');
    expect(d.releases).toBe(2);
    expect(d.stars).toBe(42);
  });
  it('maps each installer, and a missing one to null', () => {
    const r = siteData(LIST, null, 'x').release!;
    expect(r.win.installer).toEqual({ name: 'ClaudeWeb-0.3.1-win-x64.exe', url: 'https://example.test/ClaudeWeb-0.3.1-win-x64.exe', size: 231908768 });
    expect(r.win.portable?.name).toBe('ClaudeWeb-0.3.1-portable.exe');
    expect(r.mac.arm64?.name).toBe('ClaudeWeb-0.3.1-mac-arm64.dmg');
    expect(r.mac.x64).toBeNull();
  });
  it('has no release when there is no app release', () => {
    expect(siteData([LIST[0], LIST[1]], null, 'x')).toEqual({ release: null, stars: null, releases: 0, fetchedAt: 'x' });
  });
});

describe('isAppRelease / mb', () => {
  it('skips drafts, prereleases and other tags', () => {
    expect(LIST.map(isAppRelease)).toEqual([false, false, false, true, true]);
  });
  it('rounds to whole MiB', () => {
    expect(mb(231908768)).toBe('221 MB');
    expect(mb(0)).toBe('0 MB');
  });
});
