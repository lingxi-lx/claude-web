// The Agent's mouse, drawn over the page it works in (stage B task 7): a cursor that glides to where the Agent points
// — a click, a hover, a drag, a list it picks from, browser_computer's positions — and a ripple where it presses. Only
// a picture: it takes no input (pointer-events: none) and is not in the page, so a screenshot never shows it.
// The marks come from guest.ts (ops.ts `show`) through cursor.ts.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { clsx } from '@/util';
import { lastCursor, onCursor } from './cursor';
import type { CursorMark } from './ops';

/** How long the cursor stays after the Agent's last move. */
export const CURSOR_LINGER_MS = 2_500;
const RIPPLE_MS = 600;

/**
 * Where a mark of the page's own pixels is over the panel: the page element's box (it may be a device scaled down
 * and centred: viewport.ts) relative to the layer's. Null when there is nothing to place it on.
 */
export function placeMark(m: Pick<CursorMark, 'x' | 'y' | 'width' | 'height'>, page: { left: number; top: number; width: number; height: number }, layer: { left: number; top: number }): { x: number; y: number } | null {
  if (!(m.width > 0 && m.height > 0 && page.width > 0 && page.height > 0)) return null;
  const fx = Math.min(1, Math.max(0, m.x / m.width));
  const fy = Math.min(1, Math.max(0, m.y / m.height));
  return { x: Math.round(page.left - layer.left + fx * page.width), y: Math.round(page.top - layer.top + fy * page.height) };
}

export function AgentCursor({ tabId, page }: { tabId: string; page: RefObject<HTMLElement | null> }) {
  const layer = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number; down: boolean } | null>(null);
  const [shown, setShown] = useState(false);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | undefined;
    const place = (m: CursorMark) => {
      const el = page.current;
      const box = layer.current;
      if (!el || !box) return;
      const p = placeMark(m, el.getBoundingClientRect(), box.getBoundingClientRect());
      if (!p) return;
      setAt({ ...p, down: m.kind === 'down' });
      setShown(true);
      if (m.kind === 'down') {
        const id = ++seq.current;
        setRipples((r) => [...r.slice(-4), { id, ...p }]);
        setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), RIPPLE_MS);
      }
      clearTimeout(hide);
      hide = setTimeout(() => setShown(false), CURSOR_LINGER_MS);
    };
    // a layer mounted just after a mark still shows it
    const last = lastCursor(tabId);
    if (last && Date.now() - last.at < CURSOR_LINGER_MS) place(last);
    const off = onCursor(tabId, place);
    return () => { off(); clearTimeout(hide); };
  }, [tabId, page]);
  return (
    <div ref={layer} className="bw-cursor-layer" aria-hidden>
      {at && (
        <div className={clsx('bw-cursor', shown && 'on', at.down && 'down')} data-id="agent-cursor" data-shown={shown ? 'true' : 'false'} style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
          <svg width="18" height="22" viewBox="0 0 18 22"><path d="M1 1 L1 17 L5.5 13 L8.5 20.5 L11.5 19.2 L8.6 12 L14.5 12 Z" /></svg>
        </div>
      )}
      {ripples.map((r) => <span key={r.id} className="bw-ripple" data-id="agent-ripple" style={{ left: r.x, top: r.y }} />)}
    </div>
  );
}
