import type { CSSProperties } from 'react';
import { useStore } from '@/store';
import { clsx } from '@/util';
import { Icon } from '@/ui/icons';
import { QUICK_THEMES, THEME_LABEL, THEME_ORDER, THEME_PREVIEW, themeChoice, type ThemeChoice } from './theme-preview';
import { tr, getLocale } from '@/i18n';
import { listPacks } from '@/themes/registry';

// Picking a theme (final review §9 #3): `ui.theme` through setSetting, which applies it at once (the store's
// setTheme, the desktop title bar). Two places: the account popover's three and 设置 → 外观's swatches.

function useTheme(): [ThemeChoice | null, (t: ThemeChoice) => void] {
  const v = useStore((s) => s.settings['ui.theme']);
  const set = useStore((s) => s.setSetting);
  return [themeChoice(v), (t) => void set('ui.theme', t)];
}

/** The account popover: 浅色 / 深色 / 跟随系统 in one row; the popover stays open so the change is seen. */
export function ThemeQuick({ dataId }: { dataId?: string }) {
  const [cur, pick] = useTheme();
  return (
    <div className="theme-quick" role="radiogroup" aria-label={tr('主题')} data-id={dataId}>
      {QUICK_THEMES.map((t) => (
        <button key={t} role="radio" aria-checked={cur === t} className={clsx(cur === t && 'on')} data-theme-pick={t} onClick={(e) => { e.stopPropagation(); pick(t); }}>
          <Icon name={t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'monitor'} size={13} />{THEME_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

/** 设置 → 外观: every theme as a small window in its own colours (跟随系统 = half light, half dark); the character
 *  themes (themes/registry.ts) in a row of their own. */
export function ThemeSwatches({ label }: { label?: string }) {
  const [cur, pick] = useTheme();
  const v = useStore((s) => s.settings['ui.theme']);
  const packs = listPacks();
  return (
    <>
    {packs.length > 0 && (
      <div className="theme-sw ascii" role="radiogroup" aria-label={tr('字符画主题')}>
        {packs.map((p) => {
          const t = `ascii:${p.id}`;
          const vars = { '--sw-bg': p.colors.bg, '--sw-side': p.colors['bg-1'], '--sw-fg': p.colors.fg, '--sw-accent': p.colors.accent } as CSSProperties;
          const nm = getLocale() === 'zh' ? p.name.zh : p.name.en;
          return (
            <button key={t} role="radio" aria-checked={v === t} className={clsx('sw', v === t && 'on')} data-theme-pick={t} onClick={() => void useStore.getState().setSetting('ui.theme', t)} title={nm}>
              <span className="pv" style={vars} aria-hidden>
                <span className="side" />
                <span className="body"><span className="ln" /><span className="ln short" /><span className="dot" /></span>
              </span>
              <span className="nm">{nm}</span>
            </button>
          );
        })}
      </div>
    )}
    <div className="theme-sw" role="radiogroup" aria-label={label}>
      {THEME_ORDER.map((t) => {
        const p = t === 'system' ? THEME_PREVIEW.light : THEME_PREVIEW[t];
        const d = THEME_PREVIEW.dark;
        const vars = { '--sw-bg': p.bg, '--sw-side': p.side, '--sw-fg': p.fg, '--sw-accent': p.accent, '--sw-bg2': d.bg, '--sw-fg2': d.fg } as CSSProperties;
        return (
          <button key={t} role="radio" aria-checked={cur === t} className={clsx('sw', cur === t && 'on')} data-theme-pick={t} onClick={() => pick(t)} title={THEME_LABEL[t]}>
            <span className={clsx('pv', t === 'system' && 'split')} style={vars} aria-hidden>
              <span className="side" />
              <span className="body"><span className="ln" /><span className="ln short" /><span className="dot" /></span>
            </span>
            <span className="nm">{THEME_LABEL[t]}</span>
          </button>
        );
      })}
    </div>
    </>
  );
}
