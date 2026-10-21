import { describe, expect, it } from 'vitest';
import { DEFAULT_ANIMS } from './default-anims';
import { checkAnim } from './frames';
import { REQUIRED_COLORS, animFor, paletteCss, parsePack, sanitizeCss } from './pack';
import { PROCESSES } from './process';

const colors = Object.fromEntries(REQUIRED_COLORS.map((k) => [k, '#000000']));
const mini = { id: 'mini', name: { zh: '小', en: 'Mini' }, mode: 'dark', colors };

describe('parsePack', () => {
  it('accepts a minimal pack, with the default dimming', () => {
    const { pack, errors } = parsePack(mini, { backdrop: 'export default {}', css: 'a{}' });
    expect(errors).toEqual([]);
    expect(pack?.chatDim).toEqual({ opacity: 0.12, speed: 0.33 });
    expect(pack?.backdrop).toBe('export default {}');
  });
  it('rejects a missing colour, a bad colour, a bad id and a bad mode', () => {
    const { fg: _, ...noFg } = colors;
    expect(parsePack({ ...mini, colors: noFg }).errors.join()).toMatch(/colors\.fg /);
    expect(parsePack({ ...mini, colors: { ...colors, bg: 'red' } }).errors.join()).toMatch(/colors\.bg /);
    expect(parsePack({ ...mini, id: 'My Theme' }).pack).toBeUndefined();
    expect(parsePack({ ...mini, mode: 'dim' }).errors.join()).toMatch(/mode/);
  });
  it('a broken process is reported and falls back; the pack itself stays', () => {
    const { pack, errors } = parsePack({ ...mini, processes: { edit: { fps: 8, loop: [['ab'], ['abc']] } } });
    expect(pack).toBeTruthy();
    expect(errors.join()).toMatch(/processes\.edit/);
    expect(pack!.broken.edit?.length).toBeGreaterThan(0);
    expect(animFor(pack!, 'edit')).toBe(DEFAULT_ANIMS.edit);
  });
  it('an unknown process is reported', () => expect(parsePack({ ...mini, processes: { dance: {} } }).errors.join()).toMatch(/dance/));
  it('a good process without inline frames borrows the default inline', () => {
    const own = { fps: 6, loop: [['ab'], ['ba']] };
    const { pack } = parsePack({ ...mini, processes: { read: own } });
    expect(animFor(pack!, 'read').loop).toEqual(own.loop);
    expect(animFor(pack!, 'read').inline).toBe(DEFAULT_ANIMS.read.inline);
  });
});

describe('paletteCss / sanitizeCss', () => {
  it('writes the primitives on html[data-ascii]', () => {
    const css = paletteCss(parsePack(mini).pack!);
    expect(css).toContain("html:root[data-ascii='mini']");
    expect(css).toContain('--bg: #000000;');
    expect(css).toContain('color-scheme: dark');
  });
  it('drops remote imports and urls, keeps data: urls', () => {
    const out = sanitizeCss('@import url(https://x/y.css); a{background:url(http://x/a.png)} c{background:url(//x/b.png)} b{background:url(data:image/png;base64,AA)}');
    expect(out).not.toMatch(/https?:\/\/x|\/\/x/);
    expect(out).toContain('data:image/png;base64,AA');
  });
});

describe('DEFAULT_ANIMS', () => {
  for (const p of PROCESSES) {
    it(`${p}: valid, with inline frames`, () => {
      expect(checkAnim(DEFAULT_ANIMS[p])).toEqual([]);
      expect(DEFAULT_ANIMS[p].inline?.loop.length).toBeGreaterThan(0);
    });
  }
});
