import { useEffect, useRef } from 'react';
import { imeComposing } from '@/ui/ime';

/**
 * Esc closes this dialog — only when it is the innermost thing: no menu (a Select's list) is open and no dialog
 * (a dlg.confirm) lies over it. Listens on window in the capture phase, so the drawer / page under it never see the key,
 * and it works with the focus on <body> too.
 */
export function useEscClose<T extends HTMLElement>(onClose: () => void, disabled = false) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || imeComposing(e)) return;
      const me = ref.current;
      if (!me || document.querySelector('.menu')) return;
      const all = document.querySelectorAll('.modal-bg');
      if (all[all.length - 1] !== me) return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [disabled]);
  return ref;
}
