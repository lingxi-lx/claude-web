import { useEffect, useState } from 'react';
import { reducedMotion } from '@/ui/input-intent';

/** Live: the in-app 减少动画 (data-reduce-motion on <html>) and the system setting. */
export function useReducedMotion(): boolean {
  const [r, setR] = useState(reducedMotion);
  useEffect(() => {
    const on = () => setR(reducedMotion());
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduce-motion'] });
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    mq?.addEventListener('change', on);
    return () => { mo.disconnect(); mq?.removeEventListener('change', on); };
  }, []);
  return r;
}
