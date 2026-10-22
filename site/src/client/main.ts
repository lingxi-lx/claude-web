// The only script every page loads: the visitor's OS (which download button shows), the shortcuts, copy buttons.
import { detectOs, type NavLike } from './os';
import { keyAction } from './keys';

const os = detectOs(navigator as unknown as NavLike);
document.documentElement.dataset.os = os;

function target(action: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-key-action="${action}"][data-key-os="${os}"]`)
    ?? document.querySelector<HTMLElement>(`[data-key-action="${action}"]`);
}

addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  const editable = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const action = keyAction({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.isComposing, editable });
  const el = action && target(action);
  if (!el) return;
  e.preventDefault();
  el.click();
});

for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
  b.addEventListener('click', () => {
    const label = b.textContent;
    void navigator.clipboard.writeText(b.dataset.copy ?? '').then(() => {
      b.textContent = b.dataset.copied ?? label;
      setTimeout(() => { b.textContent = label; }, 1500);
    });
  });
}
