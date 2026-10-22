// The clip on show is in the URL (spec §5.1 分享): ?theme=<id>#themes. Anything unknown is phosphor.
import { CLIPS } from './clips';

export const DEFAULT_CLIP = 'phosphor';

export function clipFromSearch(search: string): string {
  const v = new URLSearchParams(search).get('theme');
  return v && CLIPS.some((c) => c.id === v) ? v : DEFAULT_CLIP;
}

export function searchWithClip(search: string, id: string): string {
  const p = new URLSearchParams(search);
  p.set('theme', id);
  return `?${p.toString()}`;
}
