import { TINTED } from './builtin.js';
import type { CafeAssign, CharacterDef } from './types.js';

/**
 * Which character someone in the cafe is (spec §4): the admin → `admin`; a guest → by its name, else by its sub-agent
 * type, else the default. An id that no longer exists is skipped; with nothing left, the built-ins.
 */
export function resolveCharacter(a: CafeAssign | undefined, who: { admin?: boolean; type?: string; name?: string }, exists: (id: string) => boolean): string {
  const pick = (id: string | undefined) => (id && exists(id) ? id : undefined);
  if (who.admin) return pick(a?.admin) ?? 'admin';
  return pick(who.name ? a?.byName?.[who.name] : undefined)
    ?? pick(who.type ? a?.byType?.[who.type] : undefined)
    ?? pick(a?.default)
    ?? 'octopus';
}

/** The assignments with every reference to `id` taken out (it was deleted). */
export function withoutCharacter(a: CafeAssign | undefined, id: string): CafeAssign {
  const strip = (m?: Record<string, string>) => (m ? Object.fromEntries(Object.entries(m).filter(([, v]) => v !== id)) : undefined);
  return {
    ...(a?.admin && a.admin !== id ? { admin: a.admin } : {}),
    ...(a?.default && a.default !== id ? { default: a.default } : {}),
    ...(a?.byType ? { byType: strip(a.byType) } : {}),
    ...(a?.byName ? { byName: strip(a.byName) } : {}),
  };
}

/** `#rrggbb` mixed towards white (t > 0) or black (t < 0). */
export function shadeHex(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** The octopus in a guest's agent colour (its body, highlight and tentacles). Other characters keep their own colours. */
export function tinted(def: CharacterDef, hex: string | undefined): CharacterDef {
  if (def.id !== 'octopus' || !hex || !/^#[0-9a-f]{6}$/i.test(hex)) return def;
  const palette = { ...def.palette };
  for (const [k, t] of Object.entries(TINTED)) palette[k] = shadeHex(hex, t);
  return { ...def, palette };
}
