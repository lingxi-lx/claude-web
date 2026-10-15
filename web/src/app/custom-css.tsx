import { useEffect } from 'react';
import { useStore } from '@/store';

/** The setting that switches custom.css off without deleting it (settings → 外观 → 自定义样式). */
export const CUSTOM_CSS_KEY = 'ui.customCss';
const ID = 'cw-custom-css';

/**
 * Put the user's stylesheet in the page, or take it out. A <style> at the end of <body>: after every built-in sheet,
 * the ones code-split chunks add to <head> later included, so its rules win at equal specificity.
 */
export function applyCustomCss(css: string | null): void {
  let el = document.getElementById(ID) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = ID;
    el.dataset.source = 'custom.css';
    document.body.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

/** Keeps the page's copy of custom.css in step with the file (hot reload) and the switch. */
export function CustomCss() {
  const css = useStore((s) => (s.customCss && !s.customCss.error ? s.customCss.css : ''));
  const on = useStore((s) => s.settings[CUSTOM_CSS_KEY] !== false);
  useEffect(() => applyCustomCss(on && css ? css : null), [css, on]);
  return null;
}
