// ← → (the official title bar's back / forward, 2026-10-17): the conversations brought to the front, in order, like a
// browser's history. Back opens the one before, forward the one after; opening another one from anywhere drops what
// was ahead. Buttons in the sidebar's top row, Alt+← / Alt+→ (⌘[ / ⌘] in the macOS menu), the mouse's side buttons.
import { create } from 'zustand';
import { useStore } from '@/store';
import { openFromSidebar } from '@/features/sidebar/rows';
import { navStep, navVisit, type NavState } from './nav-model';

export const useNav = create<NavState>(() => ({ back: [], forward: [], cur: null }));

let pending: string | null = null;

export function navGo(dir: -1 | 1): boolean {
  const st = useStore.getState();
  const exists = (id: string) => !!st.open[id] || st.sessions.some((s) => s.sessionId === id);
  const r = navStep(useNav.getState(), dir, exists);
  if (!r) return false;
  pending = r.to;
  useNav.setState(r.state);
  openFromSidebar(r.to, 'replace');
  return true;
}

let started = false;

/** Follow the conversation in front (once, app-wide), and the mouse's back / forward buttons. */
export function startNavHistory(): void {
  if (started) return;
  started = true;
  useNav.setState(navVisit(useNav.getState(), useStore.getState().activeId, false));
  useStore.subscribe((s, p) => {
    if (s.activeId === p.activeId) return;
    const moving = !!s.activeId && s.activeId === pending;
    if (moving) pending = null;
    useNav.setState((n) => navVisit(n, s.activeId, moving));
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3 || e.button === 4) { e.preventDefault(); navGo(e.button === 3 ? -1 : 1); }
  });
}
