// Where an Agent's mouse is in a tab of the built-in browser, for the cursor drawn over its page (AgentCursor.tsx).
// A tiny bus rather than store state: marks come several times a second during a drag, and only the layer of that
// one tab needs them.
import type { CursorMark } from './ops';

type Listener = (m: CursorMark) => void;
const listeners = new Map<string, Set<Listener>>();
const last = new Map<string, CursorMark & { at: number }>();

/** guest.ts: the Agent's mouse moved / pressed / let go in `tabId`'s page. */
export function markCursor(tabId: string, m: CursorMark): void {
  last.set(tabId, { ...m, at: Date.now() });
  for (const f of listeners.get(tabId) ?? []) f(m);
}

/** AgentCursor: follow one tab. Returns the unsubscribe. */
export function onCursor(tabId: string, f: Listener): () => void {
  let set = listeners.get(tabId);
  if (!set) listeners.set(tabId, (set = new Set()));
  set.add(f);
  return () => { set!.delete(f); if (!set!.size) listeners.delete(tabId); };
}

/** The last mark of a tab (a layer mounted after it still shows it while it is fresh). */
export const lastCursor = (tabId: string) => last.get(tabId);
export const forgetCursor = (tabId: string): void => { last.delete(tabId); };
