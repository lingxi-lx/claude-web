// A process animation's frames (spec 2026-10-22 §3 「帧表格式」) and the check a theme's are put through. The error
// messages are for the theme skill (Claude reads them and fixes the frames), so they stay Chinese and are not tr()'d.

/** one frame of the stage size: 1–2 rows, every row the same width */
export type Frame = string[];
export interface InlineClip { fps?: number; loop: string[]; done?: string[]; fail?: string[] }
export interface ProcessAnim {
  fps: number;
  loop: Frame[];
  done?: Frame[];
  fail?: Frame[];
  /** character → colour token (accent, green, …): the character is drawn in var(--token) */
  color?: Record<string, string>;
  inline?: InlineClip;
}

export const STAGE_ROWS = 2;
export const STAGE_COLS = 14;
export const INLINE_COLS = 3;
export const COLOR_TOKENS: readonly string[] = ['accent', 'accent-text', 'green', 'red', 'yellow', 'blue', 'fg', 'fg-1', 'fg-2', 'fg-3', ...Array.from({ length: 10 }, (_, i) => `agent-${i + 1}`)];

/** How many monospace cells a string takes: CJK / full-width = 2, combining marks and variation selectors = 0. */
export function strWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || c === 0xfe0f || c === 0xfe0e) continue;
    w += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
      || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || c >= 0x20000 ? 2 : 1;
  }
  return w;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const goodFps = (v: unknown) => typeof v === 'number' && v >= 1 && v <= 30;

/** Every problem with one process animation; empty = fine. */
export function checkAnim(a: unknown): string[] {
  if (!isObj(a)) return ['动画必须是一个对象'];
  const errs: string[] = [];
  if (!goodFps(a.fps)) errs.push('fps 必须是 1–30 的数字');
  if (!Array.isArray(a.loop) || a.loop.length === 0) errs.push('缺少 loop（至少一帧）');
  let rows = -1, width = -1;
  for (const seg of ['loop', 'done', 'fail'] as const) {
    const frames = a[seg];
    if (frames === undefined) continue;
    if (!Array.isArray(frames)) { errs.push(`${seg} 必须是帧的数组`); continue; }
    frames.forEach((f: unknown, i: number) => {
      const at = `${seg}[${i}]`;
      if (!Array.isArray(f) || f.length === 0 || f.some((r) => typeof r !== 'string')) { errs.push(`${at} 必须是 1–2 个字符串（每个是一行）`); return; }
      if (f.length > STAGE_ROWS) { errs.push(`${at} 有 ${f.length} 行，最多 2 行`); return; }
      if (rows === -1) rows = f.length;
      else if (f.length !== rows) errs.push(`${at} 的行数和第一帧不一样（应为 ${rows} 行）`);
      for (const r of f as string[]) {
        const w = strWidth(r);
        if (w > STAGE_COLS) errs.push(`${at} 有一行宽 ${w} 格，最多 14 格`);
        else if (width === -1) width = w;
        else if (w !== width) errs.push(`${at} 有一行宽度是 ${w}，和第一帧的 ${width} 不一样（每帧每行要一样宽，用空格补齐）`);
      }
    });
  }
  if (a.color !== undefined) {
    if (!isObj(a.color)) errs.push('color 必须是「字符 → 颜色名」的对象');
    else for (const [ch, tok] of Object.entries(a.color)) if (!COLOR_TOKENS.includes(tok as string)) errs.push(`color 里「${ch}」的颜色 ${String(tok)} 不认识，只能用：${COLOR_TOKENS.join(' ')}`);
  }
  if (a.inline !== undefined) {
    const il = a.inline;
    if (!isObj(il) || !Array.isArray(il.loop) || il.loop.length === 0) errs.push('inline.loop 至少要一帧');
    else {
      if (il.fps !== undefined && !goodFps(il.fps)) errs.push('inline.fps 必须是 1–30 的数字');
      for (const seg of ['loop', 'done', 'fail'] as const) {
        const fr = il[seg];
        if (fr === undefined) continue;
        if (!Array.isArray(fr) || fr.some((x: unknown) => typeof x !== 'string')) { errs.push(`inline.${seg} 必须是字符串数组`); continue; }
        for (const x of fr as string[]) if (strWidth(x) > INLINE_COLS) errs.push(`inline.${seg} 里「${x}」超过 3 格`);
      }
    }
  }
  return errs;
}
