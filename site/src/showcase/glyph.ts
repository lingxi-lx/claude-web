// A theme button's small live process animation (spec §5.1): the theme's own frames for a process, as the product's
// ProcessGlyph draws them (animFor + frameHtml), computed at build time; player.ts plays them with the product's ticker.
import { animFor, type Process, type ThemePack } from '@themes';
import { frameHtml } from '@web-themes/render';

export function glyphClip(pack: ThemePack, process: Process = 'think'): { frames: string[]; fps: number } {
  const a = animFor(pack, process);
  return { frames: a.loop.map((f) => frameHtml(f, a.color)), fps: a.fps };
}
