// The showcase's clips (spec §5.1–5.2): one 12 s recording per built-in theme, all made from the same script so
// second n is the same action in each, and one 15 s "describe a new theme". The file names here are the ones
// scripts/record-themes.cjs writes, scripts/upload-site-media.cjs lists in site/media.json and fetch-media.ts copies.
import { DESCRIBE_ID, DESCRIBE_THEME, THEME_IDS } from './ids';

export type Lang = 'en' | 'zh';
export const LANGS: readonly Lang[] = ['en', 'zh'];
export type MarkerKey = 'home' | 'turn' | 'waiting' | 'describe' | 'trial' | 'apply';
export interface Clip { id: string; palette: string; duration: number; markers: { at: number; key: MarkerKey }[]; describe: boolean }

const THEME_MARKERS: Clip['markers'] = [{ at: 0, key: 'home' }, { at: 5, key: 'turn' }, { at: 10, key: 'waiting' }];
const DESCRIBE_MARKERS: Clip['markers'] = [{ at: 0, key: 'describe' }, { at: 4, key: 'trial' }, { at: 12, key: 'apply' }];

export const CLIPS: Clip[] = [
  ...THEME_IDS.map((id) => ({ id, palette: id, duration: 12, markers: THEME_MARKERS, describe: false })),
  { id: DESCRIBE_ID, palette: DESCRIBE_THEME, duration: 15, markers: DESCRIBE_MARKERS, describe: true },
];

export const videoFile = (id: string, lang: Lang, ext: 'webm' | 'mp4', small: boolean): string => `${id}.${lang}${small ? '-sm' : ''}.${ext}`;
export const posterFile = (id: string, lang: Lang): string => `${id}.${lang}.webp`;

/** Every file site/media.json must list: per clip and language, two sizes of two encodings and a poster. */
export function expectedMediaFiles(): string[] {
  const out: string[] = [];
  for (const c of CLIPS) for (const l of LANGS) {
    for (const ext of ['webm', 'mp4'] as const) for (const small of [false, true]) out.push(videoFile(c.id, l, ext, small));
    out.push(posterFile(c.id, l));
  }
  return out.sort();
}
