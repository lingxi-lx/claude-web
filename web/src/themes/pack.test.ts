import { describe, expect, it } from 'vitest';
import { DEFAULT_ANIMS } from './default-anims';
import { checkAnim } from './frames';
import { REQUIRED_COLORS, animFor, cssRemoteRefs, paletteCss, parsePack, sanitizeCss } from './pack';
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
  it('keeps offline CSS as it is (data: urls, content strings, text with a colon, a relative address)', () => {
    const css = ".z::after{content:'status: ok'} .y{background-image:image-set('assets/a.png' 1x)} .a::before{content:'> SYS: ok'} .b{background:url(data:image/png;base64,AA//BB)} .c{background:url('data:image/svg+xml,<svg/>')}";
    expect(cssRemoteRefs(css)).toEqual([]);
    expect(sanitizeCss(css)).toBe(css);
  });
  // each of these reached the network in the 2026-10-22 review, or would
  for (const bad of [
    '@import url(https://x/y.css);',
    '@import/**/"http://x/y.css";',
    '@IMPORT "local.css";',
    'a{background:url(http://x/a.png)}',
    'a{background:url(//x/a.png)}',
    'a{background:url(/api/x)}',
    'a{background:url(\\68ttp://x/escaped)}',
    'a{background:u\\72l(http://x/escaped-fn)}',
    'a{background-image:image-set("http://x/i.png" 1x)}',
    'a{--u:"https://x/v.png"} b{background:image-set(var(--u) 1x)}',
    '@font-face{font-family:x;src:url(https://x/f.woff2)}',
    'a{cursor:url(file:///c:/x.cur),auto}',
    // the second review's three: an escaped newline in a string, an escaped quote in an identifier, a stray quote
    '.d{background-image:image-set("\\a http://x/nl.png" 1x)}',
    ".e[title=a\\27 b]{} .e2{background-image:image-set(\"http://x/pair.png\" 1x)} .e3[title=c\\27 d]{}",
    ".f{background:url(data:x')} .f2{background-image:image-set(\"http://x/badurl.png\" 1x)} .f3{content:\"'\"}",
    '@\\69mport "a.css";',
    'a{background:url("/x.png")}',
    // the third review: a backslash is a slash to the URL parser (and two make a Windows share)
    'a{background-image:image-set("\\\\/127.0.0.1:3198/bs-slash" 1x)}',
    'a{background-image:image-set("\\\\\\\\host/x" 1x)}',
    'a{background-image:image-set("\\5c\\5c host/x" 1x)}',
    'a{background-image:image-set("HtTpS:host" 1x)}',
    'a{--x:"wss://host"}',
  ]) {
    it(`drops all of it: ${bad}`, () => {
      expect(cssRemoteRefs(bad).length, bad).toBeGreaterThan(0);
      expect(sanitizeCss(bad)).toBe('');
    });
  }
  it('a pack whose CSS reaches out keeps its colours, loses its CSS and says why', () => {
    const { pack, errors } = parsePack(mini, { css: 'a{background:url(http://x/a.png)}' });
    expect(pack?.css).toBeUndefined();
    expect(errors.join()).toMatch(/theme\.css/);
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
