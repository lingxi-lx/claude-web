// Appearance settings live in meta.json (`ui.*`) and are applied as data attributes / CSS variables on <html>.
import { THEMES, type Theme } from '@/store';
import { tr } from '@/i18n';
import { asciiId, getPack } from '@/themes/registry';
import { applyAscii, isSafeMode } from '@/themes/apply';

/** a classic theme, the system's, or a character theme (`ascii:<id>`, themes/registry.ts) */
export type UiTheme = Theme | 'system' | `ascii:${string}`;
export const FONT_SIZES = [12, 13, 14, 15, 16] as const;
/** The language setting's choices; each language is named in itself. */
export const LANGUAGES = [{ id: 'auto', l: tr('跟随系统') }, { id: 'zh', l: '中文' }, { id: 'en', l: 'English' }];
export const DENSITIES = [{ id: 'compact', l: tr('紧凑') }, { id: 'comfortable', l: tr('舒适') }] as const;
export const CJK_FONTS = [
  { id: '', l: tr('系统默认') },
  { id: '"Microsoft YaHei UI", "Microsoft YaHei"', l: tr('微软雅黑') },
  { id: '"PingFang SC", "Hiragino Sans GB"', l: tr('苹方') },
  { id: '"Noto Sans CJK SC", "Source Han Sans SC"', l: tr('思源黑体') },
  { id: '"LXGW WenKai", "霞鹜文楷"', l: tr('霞鹜文楷') },
  { id: '"Sarasa UI SC", "更纱黑体 UI SC"', l: tr('更纱黑体') },
];

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let systemListener: (() => void) | null = null;
let onSystemTheme: ((t: Theme) => void) | null = null;

/** The default theme: an unset `ui.theme` follows the operating system. */
export const DEFAULT_THEME: UiTheme = 'system';

export function resolveTheme(t: UiTheme | undefined): Theme {
  if (!t || t === 'system') return mq?.matches === false ? 'light' : 'dark';
  // a character theme lays its colours over the classic theme of its own brightness
  const a = asciiId(t);
  if (a) return !isSafeMode() && getPack(a)?.mode === 'light' ? 'light' : 'dark';
  return (THEMES as readonly string[]).includes(t) ? (t as Theme) : 'dark';
}

/** Called when the OS switches light / dark while the theme follows the system (the store updates its copy + title bar). */
export function setSystemThemeHandler(fn: ((t: Theme) => void) | null) { onSystemTheme = fn; }

/** Apply every ui.* setting to the document. Idempotent; call after settings load / change. */
export function applyUiSettings(settings: Record<string, unknown>) {
  const root = document.documentElement;
  const theme = (settings['ui.theme'] as UiTheme | undefined) ?? DEFAULT_THEME;
  root.dataset.theme = resolveTheme(theme);
  applyAscii(asciiId(theme));
  if (theme === 'system' && mq && !systemListener) {
    systemListener = () => { const t = resolveTheme('system'); root.dataset.theme = t; onSystemTheme?.(t); };
    mq.addEventListener('change', systemListener);
  } else if (theme !== 'system' && mq && systemListener) {
    mq.removeEventListener('change', systemListener);
    systemListener = null;
  }
  const fs = Number(settings['ui.fontSize']) || 14;
  root.style.setProperty('--ui-font-size', `${fs}px`);
  root.dataset.density = (settings['ui.density'] as string) || 'comfortable';
  const cjk = (settings['ui.cjkFont'] as string) || '';
  root.style.setProperty('--cjk-font', cjk ? `${cjk},` : '');
  root.dataset.reduceMotion = settings['ui.reduceMotion'] ? '1' : '';
  // ui/haptics.ts reads it: on unless switched off
  root.dataset.haptics = settings['ui.haptics'] === false ? 'off' : '';
}
