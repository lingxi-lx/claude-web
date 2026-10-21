// Putting a character theme on the page (spec 2026-10-22 §2): `data-theme` stays the pack's mode (so every light /
// dark rule applies), `html[data-ascii]` names the pack, and one <style> carries its primitives and its CSS.
// Ctrl+Shift+0 (safe mode) takes it off until the next start, without touching the setting.
import { useSyncExternalStore } from 'react';
import { paletteCss, sanitizeCss, type ThemePack } from './pack';
import { getPack } from './registry';

const STYLE_ID = 'cw-ascii-theme';
let active: ThemePack | null = null;
let wanted: string | null = null;
let safe = false;
const subs = new Set<() => void>();

export function applyAscii(id: string | null) {
  wanted = id;
  const pack = safe ? null : getPack(id);
  if (pack === active) return;
  active = pack;
  const root = document.documentElement;
  let style = document.getElementById(STYLE_ID);
  if (!pack) {
    delete root.dataset.ascii;
    style?.remove();
  } else {
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
    }
    style.textContent = paletteCss(pack) + (pack.css ? sanitizeCss(pack.css) : '');
    // last in <head>: after the app's own sheets (the palette rule outranks them anyway, theme.css need not)
    document.head.appendChild(style);
    root.dataset.ascii = pack.id;
  }
  for (const f of subs) f();
}

/** Ctrl+Shift+0: back to the classic look for this run (a theme whose CSS hid the way to the settings). Picking a
 *  character theme again on 设置 → 外观 lifts it (`setSafeMode(false)`). */
export function setSafeMode(on = true) {
  safe = on;
  applyAscii(wanted);
}
export const isSafeMode = () => safe;

export function activePack(): ThemePack | null {
  return active;
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function useActivePack(): ThemePack | null {
  return useSyncExternalStore(subscribe, activePack, activePack);
}
