import { describe, expect, it } from 'vitest';
import { shownPlugins } from './plugins-model';

describe('shownPlugins (插件 → 已安装, filtered by state)', () => {
  const list = [{ id: 'b@m', enabled: false }, { id: 'a@m', enabled: true }, { id: 'c@m', enabled: true, manifest: { name: 'Zed' } }, { id: 'd@m' }];
  it('all: on ones first, then by name', () => {
    expect(shownPlugins(list, 'all').map((p) => p.id)).toEqual(['a@m', 'c@m', 'b@m', 'd@m']);
  });
  it('on / off', () => {
    expect(shownPlugins(list, 'on').map((p) => p.id)).toEqual(['a@m', 'c@m']);
    expect(shownPlugins(list, 'off').map((p) => p.id)).toEqual(['b@m', 'd@m']);
  });
});
