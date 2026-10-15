import { tr } from '@/i18n';
// A code block that has text but shows none (reported 2026-10-09: the header says「12 行」, the body is blank —
// never reproduced here). CodeBlock measures itself a moment after its text settles; when the text is missing,
// takes no room or is drawn in its background colour it redraws once, then falls back to plain text, and says in
// server.log what it saw (never the code itself) so the next report comes with a cause.

export type BlankProblem = 'empty' | 'collapsed' | 'invisible';
/** 0 = as drawn, 1 = redrawn once (fresh DOM), 2 = plain text (no highlighting) */
export type BlankFix = 0 | 1 | 2;
export type BlankOutcome = 'redrawn' | 'plain' | 'still';

/** after the last change to the text: a streaming block is measured only once it pauses */
export const BLANK_CHECK_MS = 800;
/** reports per page load: the server dedups too, but the numbers differ from block to block */
export const BLANK_REPORTS_MAX = 5;

/** What the page actually drew for one block. */
export interface CodeProbe {
  /** characters of text in the block's DOM (whitespace not counted) */
  textLen: number;
  /** the block has a box on screen (not inside something hidden) */
  rendered: boolean;
  /** height of the code element / line table */
  height: number;
  lineHeight: number;
  /** computed text colour of the code, and the background behind it */
  color: string;
  background: string;
}

type Rgba = [number, number, number, number];

function parseColor(c: string): Rgba | null {
  const s = c.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [Number(m[1]), Number(m[2]), Number(m[3]), a];
}

function luminance([r, g, b]: Rgba): number {
  const ch = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** Text that cannot be seen: fully transparent, or (on an opaque background) next to no contrast with it. */
export function invisibleColor(color: string, background: string): boolean {
  const fg = parseColor(color);
  if (!fg) return false;
  if (fg[3] === 0) return true;
  const bg = parseColor(background);
  if (!bg || bg[3] < 1) return false;
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) < 1.3;
}

/** What is wrong with a block that should show `expected` across `lines` lines, or null when nothing is. */
export function blankProblem(expected: string, p: CodeProbe, lines: number): BlankProblem | null {
  if (!expected.trim()) return null;
  if (p.textLen === 0) return 'empty';
  if (!p.rendered) return null;
  if (lines >= 2 && p.height < p.lineHeight * 0.5) return 'collapsed';
  if (invisibleColor(p.color, p.background)) return 'invisible';
  return null;
}

/** After a measurement: draw again (`fix`), report how it ended (`report`), or nothing to do (null). */
export function nextStep(fix: BlankFix, problem: BlankProblem | null): { fix: BlankFix } | { report: BlankOutcome } | null {
  if (problem) return fix < 2 ? { fix: (fix + 1) as BlankFix } : { report: 'still' };
  if (fix === 1) return { report: 'redrawn' };
  if (fix === 2) return { report: 'plain' };
  return null;
}

/** "Chrome 130", "Edge 130", "Electron 44" … from a user agent string. */
export function browserOf(ua: string): string {
  const tests: [string, RegExp][] = [
    ['Electron', /Electron\/(\d+)/], ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/], ['QQBrowser', /QQBrowser\/(\d+)/], ['UC', /UCBrowser\/(\d+)/],
    ['Opera', /OPR\/(\d+)/], ['Firefox', /Firefox\/(\d+)/], ['Chrome', /Chrome\/(\d+)/], ['Safari', /Version\/(\d+)[\d.]* .*Safari\//],
  ];
  for (const [name, re] of tests) { const m = re.exec(ua); if (m) return `${name} ${m[1]}`; }
  return tr('未知浏览器');
}

export interface BlankInfo {
  problem: BlankProblem;
  outcome: BlankOutcome;
  /** the fence's language; undefined = guessed by the highlighter */
  lang?: string;
  lines: number;
  chars: number;
  streaming: boolean;
  /** a page translator that marked the page (Google 翻译 …), seen before the redraw */
  translated: string | null;
  /** element / attribute names inside the block that React did not put there, seen before the redraw */
  foreignTags: string[];
  foreignAttrs: string[];
  forcedColors: boolean;
  desktop: boolean;
  browser: string;
}

const PROBLEM_TEXT: Record<BlankProblem, string> = {
  empty: tr('代码块有内容却显示为空'),
  collapsed: tr('代码块有内容却不占位置'),
  invisible: tr('代码块的字和底色一样、看不见'),
};
const OUTCOME_TEXT: Record<BlankOutcome, string> = {
  redrawn: tr('重画一次后恢复'),
  plain: tr('改成纯文本后恢复'),
  still: tr('重画和改成纯文本都没用'),
};

const few = (xs: string[]) => (xs.length > 3 ? tr('{xs} 等 {xsCount} 种', { xs: xs.slice(0, 3).join('、'), xsCount: xs.length }) : xs.join('、'));

/** One server.log line (`client.log`, level warn). Names and counts only — the code may be private. */
export function blankMessage(i: BlankInfo): string {
  const parts = [
    `${PROBLEM_TEXT[i.problem]}，${OUTCOME_TEXT[i.outcome]}`,
    tr('语言 {lang}', { lang: i.lang || tr('自动识别') }),
    tr('{lines} 行', { lines: i.lines }),
    tr('{chars} 字', { chars: i.chars }),
    i.streaming ? tr('正在输出') : tr('已完成'),
  ];
  if (i.translated) parts.push(tr('页面被 {translated} 改过', { translated: i.translated }));
  if (i.foreignTags.length) parts.push(tr('外来标签 {few}', { few: few(i.foreignTags) }));
  if (i.foreignAttrs.length) parts.push(tr('外来属性 {few}', { few: few(i.foreignAttrs) }));
  if (i.forcedColors) parts.push(tr('系统高对比度'));
  parts.push(i.browser, i.desktop ? tr('桌面版') : tr('浏览器'));
  return parts.join(' · ');
}
