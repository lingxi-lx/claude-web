// The right-click menu of our windows and of the built-in browser's pages (main.ts → attachContextMenu). Chromium
// shows none of its own in Electron, so before this a right click on chat text / an input box / a code block did
// nothing at all. What goes in it is decided here, from the `context-menu` event's params, without Electron (tested).
//
// No double menus: our own menus (file tree, tabs, sidebar rows…) call preventDefault() on the DOM `contextmenu`
// event, and then Chromium never asks the browser process for a menu — Electron emits no `context-menu` for that
// click (checked on Electron 44 with a probe page, 2026-10-20). So no handshake with the page is needed.
import { tr } from './i18n.js';

/** The part of Electron's ContextMenuParams this reads. */
export interface MenuParams {
  isEditable: boolean;
  selectionText: string;
  linkURL: string;
  mediaType: string;
  hasImageContents?: boolean;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canDelete: boolean; canSelectAll: boolean };
}

export type EditRole = 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll';
export type MenuItem =
  | { type: 'separator' }
  | { type: 'edit'; role: EditRole; label: string; enabled: boolean }
  | { type: 'replace'; word: string; label: string }
  | { type: 'addWord'; word: string; label: string }
  | { type: 'quote'; text: string; label: string }
  | { type: 'copyLink'; url: string; label: string }
  | { type: 'copyImage'; label: string };

const LINK = /^(https?|mailto|file|ftp):/i;

/** The menu for one right click; empty: show none. */
export function menuItems(p: MenuParams): MenuItem[] {
  const groups: MenuItem[][] = [];
  const f = p.editFlags;
  if (p.isEditable) {
    // spelling first, like Chromium's own menu (only when spellcheck is on for the page)
    const spell: MenuItem[] = (p.dictionarySuggestions ?? []).slice(0, 5).map((w) => ({ type: 'replace', word: w, label: w }));
    if (p.misspelledWord) spell.push({ type: 'addWord', word: p.misspelledWord, label: tr('添加到字典') });
    groups.push(spell);
    groups.push([
      { type: 'edit', role: 'cut', label: tr('剪切'), enabled: f.canCut },
      { type: 'edit', role: 'copy', label: tr('复制'), enabled: f.canCopy },
      { type: 'edit', role: 'paste', label: tr('粘贴'), enabled: f.canPaste },
      { type: 'edit', role: 'delete', label: tr('删除'), enabled: f.canDelete },
    ]);
    groups.push([{ type: 'edit', role: 'selectAll', label: tr('全选'), enabled: f.canSelectAll }]);
  } else if (p.selectionText.trim()) {
    groups.push([
      { type: 'edit', role: 'copy', label: tr('复制'), enabled: true },
      { type: 'quote', text: p.selectionText, label: tr('引用到输入框') },
    ]);
    groups.push([{ type: 'edit', role: 'selectAll', label: tr('全选'), enabled: true }]);
  }
  if (p.linkURL && LINK.test(p.linkURL)) groups.push([{ type: 'copyLink', url: p.linkURL, label: tr('复制链接') }]);
  if (p.mediaType === 'image' && p.hasImageContents !== false) groups.push([{ type: 'copyImage', label: tr('复制图片') }]);
  const out: MenuItem[] = [];
  for (const g of groups) {
    if (!g.length) continue;
    if (out.length) out.push({ type: 'separator' });
    out.push(...g);
  }
  return out;
}
