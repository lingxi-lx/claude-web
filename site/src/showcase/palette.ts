// The showcase takes its colours from the theme on show (spec §5.1). A theme button wears its own theme's palette
// under the product's names (--bg, --accent…: the process frames colour characters with var(--accent) and so on);
// the section wears the current one under --sc-* names, registered with @property in showcase.css so a switch
// transitions. Both come from the product's paletteCss, so a palette means the same here as in the app.
import { paletteCss, type ThemePack } from '@themes';

export const SECTION_VARS = ['bg', 'bg-1', 'bg-2', 'bg-3', 'line', 'line-1', 'fg', 'fg-1', 'fg-2', 'accent', 'accent-text', 'accent-fg'] as const;

/** paletteCss's rule with its `html:root[data-ascii=…]` selector swapped for `selector`. */
export function scopedPaletteCss(p: ThemePack, selector: string): string {
  const css = paletteCss(p);
  const head = `html:root[data-ascii='${p.id}']`;
  if (!css.startsWith(head)) throw new Error('paletteCss no longer starts with its html:root selector');
  return selector + css.slice(head.length);
}

export function sectionVarsCss(p: ThemePack, selector: string): string {
  const decl = SECTION_VARS.map((k) => `  --sc-${k}: ${p.colors[k]};`).join('\n');
  return `${selector} {\n${decl}\n  color-scheme: ${p.mode};\n}\n`;
}

export function showcaseCss(entries: { key: string; pack: ThemePack }[]): string {
  return entries
    .map(({ key, pack }) => scopedPaletteCss(pack, `.sc-pick[data-sc-palette='${key}']`) + sectionVarsCss(pack, `.showcase[data-sc-current='${key}']`))
    .join('');
}
