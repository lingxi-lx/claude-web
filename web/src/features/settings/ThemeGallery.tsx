import { useRef, useState, type CSSProperties } from 'react';
import { useStore } from '@/store';
import { clsx } from '@/util';
import { Icon } from '@/ui/icons';
import { dlg } from '@/ui/dialog';
import { ws } from '@/ws/client';
import { tr, getLocale } from '@/i18n';
import { Menu } from '@/features/sidebar/menus';
import { runCommand } from '@/features/workbench/commands';
import { fillComposer } from '@/features/composer/fill';
import { type Process, type ThemePack } from '@themes';
import { BackdropPreview } from '@/themes/Backdrop';
import { ProcessGlyph } from '@/themes/ProcessGlyph';
import { setSafeMode } from '@/themes/apply';
import { isBuiltin, usePacks } from '@/themes/registry';

/** What the 「＋ 描述一个新主题」 card types into a new conversation (the user finishes the sentence). */
export const THEME_MAKER_PROMPT = tr('用 ascii-theme 帮我做一个字符画主题：');

/** A new conversation, its input holding the ask; `edit`: change one of the user's themes. */
export function openThemeMaker(edit?: ThemePack) {
  useStore.setState({ settingsOpen: null });
  runCommand('new');
  const text = edit ? tr('用 ascii-theme 改一改我的主题「{name}」（id：{id}）：', { name: name(edit), id: edit.id }) : THEME_MAKER_PROMPT;
  setTimeout(() => fillComposer({ text, focus: true }), 80);
}

const name = (p: ThemePack) => (getLocale() === 'zh' ? p.name.zh : p.name.en);
/** the four a card shows under its picture while the pointer is on it */
const SHOWN: Process[] = ['think', 'edit', 'read', 'test'];

function ThemeCard({ pack, on, onPick }: { pack: ThemePack; on: boolean; onPick: () => void }) {
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState(false);
  const [broken, setBroken] = useState(false);
  const own = !isBuiltin(pack.id);
  const c = pack.colors;
  const vars = { '--tc-bg': c.bg, '--tc-side': c['bg-1'], '--tc-fg': c.fg, '--tc-dim': c['fg-3'], '--tc-accent': c.accent, '--tc-accent-text': c['accent-text'] } as CSSProperties;
  // the process strip draws in var(--token): the card's own colours, not the page's
  const tokens = Object.fromEntries(Object.entries(c).filter(([k]) => /^(accent|accent-text|green|red|yellow|blue|fg|fg-[123]|agent-\d+)$/.test(k)).map(([k, x]) => [`--${k}`, x])) as CSSProperties;
  const live = (hover || on) && !broken;
  const remove = async () => {
    setMenu(false);
    if (!(await dlg.confirm(tr('删除主题「{name}」？', { name: name(pack) }), { danger: true, focusCancel: true }))) return;
    if (useStore.getState().settings['ui.theme'] === `ascii:${pack.id}`) await useStore.getState().setSetting('ui.theme', 'system');
    await ws.request({ kind: 'themes.delete', id: pack.id }).catch((e) => useStore.getState().toast(e.message));
  };
  return (
    <div className="tc-wrap">
      <button type="button" role="radio" aria-checked={on} className={clsx('tc', on && 'on')} data-theme-pick={`ascii:${pack.id}`} style={vars} title={name(pack)}
        onClick={onPick} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}
        onContextMenu={own ? (e) => { e.preventDefault(); setMenu(true); } : undefined}>
        <span className="tc-pic" aria-hidden>
          {live ? <BackdropPreview pack={pack} onFail={() => setBroken(true)} /> : <span className="tc-still"><span className="tc-sun" /><span className="tc-ln" /><span className="tc-ln short" /></span>}
          {live && (
            <span className="tc-procs" style={tokens}>
              {SHOWN.map((p) => <ProcessGlyph key={p} process={p} size="stage" pack={pack} />)}
            </span>
          )}
        </span>
        <span className="tc-nm">{name(pack)}{own && <span className="tc-own">{tr('我的')}</span>}{on && <Icon name="check" size={13} />}</span>
      </button>
      {menu && (
        <Menu onClose={() => setMenu(false)} label={tr('主题')} align="left">
          <button type="button" role="menuitem" onClick={() => { setMenu(false); openThemeMaker(pack); }}><Icon name="edit" size={14} /> {tr('改一改')}</button>
          <button type="button" role="menuitem" className="danger" onClick={() => void remove()}><Icon name="trash" size={14} /> {tr('删除')}</button>
        </Menu>
      )}
    </div>
  );
}

/**
 * 设置 → 外观 → 字符画主题 (spec 2026-10-22 §7): every character theme as a card in its own colours; the one under the
 * pointer (and the one in use) runs its backdrop and four of its process animations; the user's own have 「改一改」
 * and 「删除」 on a right click; the last card opens a conversation that makes a new one.
 */
export function ThemeGallery() {
  const packs = usePacks();
  const v = useStore((s) => s.settings['ui.theme']);
  const pick = (id: string) => { setSafeMode(false); void useStore.getState().setSetting('ui.theme', `ascii:${id}`); };
  const box = useRef<HTMLDivElement>(null);
  return (
    <div className="theme-gallery" role="radiogroup" aria-label={tr('字符画主题')} ref={box}>
      {packs.map((p) => <ThemeCard key={p.id} pack={p} on={v === `ascii:${p.id}`} onPick={() => pick(p.id)} />)}
      <div className="tc-wrap">
        <button type="button" className="tc new" data-theme-new onClick={() => openThemeMaker()}>
          <span className="tc-pic" aria-hidden><Icon name="plus" size={22} /></span>
          <span className="tc-nm">{tr('描述一个新主题')}</span>
        </button>
      </div>
    </div>
  );
}
