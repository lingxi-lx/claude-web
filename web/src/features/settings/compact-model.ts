// 自动压缩 and the Claude account's 200K / 1M (spec 2026-10-24 A7): what the editors save, what they refuse, and the
// 「现在：…」 line. Pure; CompactAt.tsx / AccountWindows.tsx draw it.
import { compactAtOk, familyWindows, parseTokens, type AccountWindows } from '@account-window';
import type { CompactSource, Provider } from '@shared';
import { tr } from '@/i18n';
import { fmtWindow } from '@/features/info/info-model';
import { contextWindowFor } from '../../../../server/src/models/context-window';

export type CompactMode = 'follow' | 'at';
/** Why a typed point is not saved: under the 50K floor (or not a number), or over the window. */
export type CompactErr = { kind: 'min' } | { kind: 'over'; window: number };

const MIN = 50_000;
const ONE_M = 1_000_000;

/** The draft → what to save: 跟着上下文窗口 is unset; a point is saved only when it holds (`compactAtOk`). */
export function compactValue(mode: CompactMode, text: string, window: number | undefined): { value?: number; error?: CompactErr } {
  if (mode === 'follow') return { value: undefined };
  const n = parseTokens(text);
  if (n === undefined || n < MIN) return { error: { kind: 'min' } };
  if (!compactAtOk(n, window)) return { error: { kind: 'over', window: window! } };
  return { value: n };
}

/** A saved point back into the box, short (700k, 1m, 1.5m); an odd number as it is. */
export function compactText(v: number | undefined): string {
  if (!v) return '';
  if (v % 100_000 === 0 && v >= ONE_M) return `${v / ONE_M}m`;
  if (v % 1000 === 0) return `${v / 1000}k`;
  return String(v);
}

/** The window the account's point is checked against: the largest of the picks (a family left alone is 1M). */
export function accountCompactWindow(w: AccountWindows): number {
  return Math.max(w.opus ?? ONE_M, w.sonnet ?? ONE_M, w.fable ?? ONE_M);
}

/** A provider's: its default model's window when that is known; otherwise none (only the 50K floor). */
export function compactWindowOfProvider(p: Pick<Provider, 'defaultModel' | 'contextWindows' | 'modelContext'>): number | undefined {
  const m = p.defaultModel?.trim();
  return m ? contextWindowFor(p, m) : undefined;
}

/** The picks as stored (settings `claude.contextWindows` / a claude-account profile's `contextWindows`); none = unset. */
export function savedWindows(w: AccountWindows): AccountWindows | undefined {
  const out = familyWindows(w);
  return Object.keys(out).length ? out : undefined;
}

/** What is in effect while the editor is unset (`config.compactSource`); '' while it loads. */
export function nowLine(src: CompactSource | null): string {
  if (!src) return '';
  if (src.source === 'settings' && src.value) return tr('现在：{v}（来自你的 settings.json）', { v: fmtWindow(src.value) });
  if (src.source === 'env' && src.value) return tr('现在：{v}（来自环境变量）', { v: fmtWindow(src.value) });
  return tr('现在：跟着上下文窗口');
}

/** The account row's one line: each family's window, then the 自动压缩 point when one is set. */
export function accountSummary(w: AccountWindows, compactAt: number | undefined): string {
  const fam = (['opus', 'sonnet', 'fable'] as const).map((f) => `${f[0].toUpperCase()}${f.slice(1)} ${fmtWindow(w[f] ?? ONE_M)}`);
  return [...fam, ...(compactAt ? [`${tr('自动压缩')} ${fmtWindow(compactAt)}`] : [])].join(' · ');
}

/** The refusal, in words. */
export function compactErrText(e: CompactErr): string {
  return e.kind === 'min' ? tr('最少 50K') : tr('不能超过上下文窗口 {w}', { w: fmtWindow(e.window) });
}
