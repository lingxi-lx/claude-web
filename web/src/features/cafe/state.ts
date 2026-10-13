// 网吧's own small store: the character library (characters.list, kept fresh by characters.changed) and the receipts
// each cafe has printed (the page's 今日账单 reads them).
import { create } from 'zustand';
import { BUILTIN, type CafeAssign, type CharacterDef, type CharactersList } from '@characters';
import { ws } from '@/ws/client';
import { useStore } from '@/store';
import type { Receipt } from './sim';
import { forgetCharacter } from './bake';

interface CafeState {
  list: CharacterDef[];
  byId: Map<string, CharacterDef>;
  assign: CafeAssign;
  loaded: boolean;
  /** by conversation, newest first */
  receipts: Record<string, Receipt[]>;
  library: boolean;
}

const index = (list: CharacterDef[]) => new Map(list.map((c) => [c.id, c]));

export const useCafe = create<CafeState>(() => ({ list: BUILTIN, byId: index(BUILTIN), assign: {}, loaded: false, receipts: {}, library: false }));

/** The night palette of the agents' colours (the room is always at night: tokens.css's dark --agent-1…10). */
export const AGENT_NIGHT = ['#a3e635', '#fbbf24', '#2dd4bf', '#f472b6', '#60a5fa', '#a78bfa', '#fb923c', '#22d3ee', '#e879f9', '#4ade80'];

let installed = false;
async function load() {
  try {
    const r = await ws.request<CharactersList>({ kind: 'characters.list' });
    for (const c of r.characters) if (!c.builtin) forgetCharacter(c.id);
    useCafe.setState({ list: r.characters, byId: index(r.characters), assign: r.assign ?? {}, loaded: true });
  } catch { /* an older server: the built-ins */ }
}

/** Once, in App: load the library when connected, again whenever it changes. */
export function installCafe() {
  if (installed) return;
  installed = true;
  let was = false;
  useStore.subscribe((s) => {
    if (s.connected && !was) void load();
    was = s.connected;
  });
  if (useStore.getState().connected) { was = true; void load(); }
  ws.on((e: any) => { if (e?.kind === 'characters.changed') void load(); });
}

export function setReceipts(sessionId: string, r: Receipt[]) {
  if (useCafe.getState().receipts[sessionId] === r) return;
  useCafe.setState((s) => ({ receipts: { ...s.receipts, [sessionId]: r } }));
}

export const openLibrary = () => useCafe.setState({ library: true });
export const closeLibrary = () => useCafe.setState({ library: false });
