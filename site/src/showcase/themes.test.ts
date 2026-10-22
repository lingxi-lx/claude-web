import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, contrastProblems, paletteCss } from '@themes';
import { DESCRIBE_THEME, THEME_IDS } from './ids';
import { PACKS } from './themes';
import { scopedPaletteCss, sectionVarsCss, showcaseCss, SECTION_VARS } from './palette';
import { glyphClip } from './glyph';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const ALL = [...THEME_IDS, DESCRIBE_THEME];

describe('the showcase themes', () => {
  it('are the product\'s built-in themes, in its order', () => {
    const src = fs.readFileSync(path.join(ROOT, 'web/src/themes/builtin/index.ts'), 'utf8');
    const m = /export const ORDER = (\[[^\]]*\]);/.exec(src);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1].replace(/'/g, '"'))).toEqual([...THEME_IDS]);
  });

  it('all parse, with both names and a palette', () => {
    for (const id of ALL) {
      const p = PACKS[id];
      expect(p.id).toBe(id);
      expect(p.name.zh.length).toBeGreaterThan(0);
      expect(p.name.en.length).toBeGreaterThan(0);
      expect(paletteCss(p)).toContain('--bg:');
    }
    expect(['paper', 'letters', 'ink'].map((id) => PACKS[id].mode)).toEqual(['light', 'light', 'light']);
  });

  it('read well in the section and on their buttons', () => {
    for (const id of ALL) {
      const c = PACKS[id].colors;
      expect(contrastProblems(c), id).toEqual([]);
      const pairs: [string, string, number][] = [
        ['fg', 'bg-1', 7], ['fg-1', 'bg-1', 4.5], ['fg-2', 'bg-1', 4.5], // the section: title, text, markers
        ['fg-1', 'bg-2', 4.5], // the title bar
        ['fg', 'bg-2', 7], ['fg-2', 'bg-2', 4.5], // a theme button: name, light / dark tag
        ['accent-fg', 'accent', 4.5], // the compare toggle when on, the play button
      ];
      for (const [ink, ground, min] of pairs) expect(contrast(c[ink], c[ground]), `${id} ${ink} on ${ground}`).toBeGreaterThanOrEqual(min);
    }
  });

  it('scopes a palette to the given selector', () => {
    const css = scopedPaletteCss(PACKS.ink, ".sc-pick[data-sc-palette='ink']");
    expect(css.startsWith(".sc-pick[data-sc-palette='ink'] {")).toBe(true);
    expect(css).toContain(`--accent: ${PACKS.ink.colors.accent};`);
    expect(css).not.toContain('html:root');
    const sec = sectionVarsCss(PACKS.ink, ".showcase[data-sc-current='ink']");
    for (const k of SECTION_VARS) expect(sec).toContain(`--sc-${k}: ${PACKS.ink.colors[k]};`);
    expect(sec).toContain('color-scheme: light;');
  });

  it('writes one button rule and one section rule per clip', () => {
    const css = showcaseCss([...THEME_IDS.map((id) => ({ key: id, pack: PACKS[id] })), { key: 'describe', pack: PACKS.metro }]);
    expect(css.match(/\.sc-pick\[data-sc-palette='/g)).toHaveLength(11);
    expect(css.match(/\.showcase\[data-sc-current='/g)).toHaveLength(11);
    expect(css).toContain(".showcase[data-sc-current='describe']");
  });

  it('gives every theme a small live process animation', () => {
    for (const id of ALL) {
      const g = glyphClip(PACKS[id]);
      expect(g.frames.length).toBeGreaterThan(0);
      expect(g.fps).toBeGreaterThanOrEqual(1);
      expect(g.fps).toBeLessThanOrEqual(30);
      expect(g.frames.join('')).not.toMatch(/<script|<\/script/i);
    }
  });
});
