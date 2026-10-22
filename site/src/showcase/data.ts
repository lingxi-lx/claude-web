// What Showcase.astro writes into the page (#sc-data) for player.ts.
export interface ClipData {
  id: string;
  /** on its button */
  name: string;
  /** in the window's title bar: "Claude Web — <title>" */
  title: string;
  duration: number;
  describe: boolean;
  markers: { at: number; label: string }[];
  /** the button's live process animation: frames as HTML (the product's frameHtml) */
  glyph: { frames: string[]; fps: number };
}
export interface ShowcaseData {
  locale: 'en' | 'zh';
  /** where the recordings are: <base>themes/ */
  base: string;
  /** site/media.json webmCodecs, for canPlayType */
  webmCodecs: string;
  clips: ClipData[];
}
