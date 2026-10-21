// Which character themes there are. `ui.theme` names one as `ascii:<id>`.
import { BUILTIN_SOURCES } from './builtin';
import { parsePack, type ThemePack } from './pack';

const PREFIX = 'ascii:';

export function asciiId(v: unknown): string | null {
  return typeof v === 'string' && v.startsWith(PREFIX) && v.length > PREFIX.length ? v.slice(PREFIX.length) : null;
}

const builtin: ThemePack[] = BUILTIN_SOURCES.flatMap((s) => {
  const { pack } = parsePack(s.json, { backdrop: s.backdrop, css: s.css });
  return pack ? [pack] : [];
});

export function listPacks(): ThemePack[] {
  return builtin;
}

export function getPack(id: string | null | undefined): ThemePack | null {
  return id ? builtin.find((p) => p.id === id) ?? null : null;
}
