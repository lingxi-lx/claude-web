import { afterEach, describe, expect, it } from 'vitest';
import { pageLocale, tr } from './engine-i18n';
import { createWorld } from './engine';
import { AGENT_NIGHT } from './palette';

const setLang = (lang: string | undefined) => {
  (globalThis as any).document = lang === undefined ? undefined : { documentElement: { lang } };
};
afterEach(() => setLang(undefined));

describe('the engine\'s tr() on the site', () => {
  it('follows <html lang>', () => {
    setLang('zh-CN');
    expect(pageLocale()).toBe('zh');
    expect(tr('网管')).toBe('网管');
    setLang('en');
    expect(pageLocale()).toBe('en');
    expect(tr('网管')).toBe('the admin');
    expect(tr('网费 {yuan}', { yuan: '¥1.00' })).toBe('Tab ¥1.00');
  });
  it('without a page it is English', () => {
    expect(pageLocale()).toBe('en');
  });
  it('the engine runs through the aliases', () => {
    setLang('en');
    const w = createWorld(1, 0);
    expect(w.map.cols).toBe(34);
    expect(w.admin.key).toBe('admin');
  });
  it('the night palette is the product\'s', () => {
    expect(AGENT_NIGHT).toHaveLength(10);
    expect(AGENT_NIGHT[0]).toBe('#a3e635');
  });
});
