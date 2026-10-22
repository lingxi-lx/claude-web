// Build time only: every showcase theme's theme.json, parsed the way the product parses it. Not imported by the
// browser side (the packs are large; Showcase.astro writes what the page needs).
import { parsePack, type ThemePack } from '@themes';
import phosphor from '@web-themes/builtin/phosphor/theme.json';
import abyss from '@web-themes/builtin/abyss/theme.json';
import koi from '@web-themes/builtin/koi/theme.json';
import moon from '@web-themes/builtin/moon/theme.json';
import dither from '@web-themes/builtin/dither/theme.json';
import orb from '@web-themes/builtin/orb/theme.json';
import garden from '@web-themes/builtin/garden/theme.json';
import paper from '@web-themes/builtin/paper/theme.json';
import letters from '@web-themes/builtin/letters/theme.json';
import ink from '@web-themes/builtin/ink/theme.json';
import metro from '../../../scripts/lib/fixtures/theme-metro/theme.json';
import { DESCRIBE_THEME, THEME_IDS } from './ids';

const RAW: Record<string, unknown> = { phosphor, abyss, koi, moon, dither, orb, garden, paper, letters, ink, metro };

function load(id: string): ThemePack {
  const { pack, errors } = parsePack(RAW[id]);
  if (!pack) throw new Error(`showcase theme ${id}: ${errors.join('; ')}`);
  return pack;
}

export const PACKS: Record<string, ThemePack> = Object.fromEntries([...THEME_IDS, DESCRIBE_THEME].map((id) => [id, load(id)]));
