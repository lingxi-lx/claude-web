// Which character themes there are: the built-in ones (themes/builtin) and the user's own, saved with the theme
// skill under ~/.claude-web/themes (the server sends them: `themes.list`, again on `themes.changed`). `ui.theme`
// names one as `ascii:<id>`; a built-in id wins over a user theme with the same one.
import { useSyncExternalStore } from 'react';
import { parsePack, type ThemePack } from '@themes';
import { BUILTIN_SOURCES } from './builtin';

const PREFIX = 'ascii:';

export function asciiId(v: unknown): string | null {
  return typeof v === 'string' && v.startsWith(PREFIX) && v.length > PREFIX.length ? v.slice(PREFIX.length) : null;
}

const builtin: ThemePack[] = BUILTIN_SOURCES.flatMap((s) => {
  const { pack } = parsePack(s.json, { backdrop: s.backdrop, css: s.css });
  return pack ? [pack] : [];
});
const builtinIds = new Set(builtin.map((p) => p.id));

export interface UserThemeSource { id: string; json: string; backdrop?: string; css?: string; mtime?: number }

let user: ThemePack[] = [];
let all: ThemePack[] = builtin;
const subs = new Set<() => void>();

/** The user's saved themes, as the server sent them (the ones that do not parse, or take a built-in id, are left out). */
export function setUserThemes(list: readonly UserThemeSource[]) {
  user = list.flatMap((s) => {
    if (builtinIds.has(s.id)) return [];
    let json: unknown;
    try { json = JSON.parse(s.json); } catch { return []; }
    const { pack } = parsePack(json, { backdrop: s.backdrop, css: s.css });
    return pack && pack.id === s.id ? [pack] : [];
  });
  all = [...builtin, ...user];
  for (const f of subs) f();
}

export function listPacks(): ThemePack[] {
  return all;
}

export function userPacks(): ThemePack[] {
  return user;
}

export function getPack(id: string | null | undefined): ThemePack | null {
  return id ? all.find((p) => p.id === id) ?? null : null;
}

/** a theme that ships with the app (its backdrop runs even where the worker's CSP is missing) */
export function isBuiltin(id: string): boolean {
  return builtinIds.has(id);
}

export const subscribePacks = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** every theme, re-rendering when the user's change */
export function usePacks(): ThemePack[] {
  return useSyncExternalStore(subscribePacks, listPacks, listPacks);
}
