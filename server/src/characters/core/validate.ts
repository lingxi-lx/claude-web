import { GRID, MAX_COLORS, MAX_EYE_PIXELS, type AssignTarget, type CharacterDef } from './types.js';

const ID = /^[a-z0-9-]{1,40}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Check a character as a model or a file gave it. The errors are short Chinese sentences for the model that wrote it,
 * each pointing at the place («front 第 3 行有 23 个字符，要 24 个»), so it can fix the drawing and try again.
 */
export function validateCharacter(x: unknown): { ok: true; def: CharacterDef } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, errors: ['角色要是一个 JSON 对象'] };
  const c = x as Record<string, any>;
  if (typeof c.id !== 'string' || !ID.test(c.id)) errors.push(`id 要是 1–40 个小写字母、数字或 -（现在是 ${JSON.stringify(c.id)}）`);
  const name = typeof c.name === 'string' ? c.name.trim() : '';
  if (!name || [...name].length > 16) errors.push('name 要有 1–16 个字');
  const palette: Record<string, string> = {};
  if (!c.palette || typeof c.palette !== 'object' || Array.isArray(c.palette)) errors.push('palette 要是一个 { 字母: "#rrggbb" } 对象');
  else {
    const keys = Object.keys(c.palette);
    if (!keys.length) errors.push('palette 至少要有一种颜色');
    if (keys.length > MAX_COLORS) errors.push(`palette 最多 ${MAX_COLORS} 种颜色（现在 ${keys.length} 种）`);
    for (const k of keys) {
      const v = c.palette[k];
      if ([...k].length !== 1 || k === '.') errors.push(`palette 的键 ${JSON.stringify(k)} 要是一个字符，而且不能是 .`);
      else if (typeof v !== 'string' || !COLOR.test(v)) errors.push(`palette.${k} 的颜色 ${JSON.stringify(v)} 不是 #rrggbb`);
      else palette[k] = v.toLowerCase();
    }
  }
  for (const side of ['front', 'back'] as const) {
    const rows = c[side];
    if (!Array.isArray(rows) || rows.length !== GRID) { errors.push(`${side} 要是 ${GRID} 行（现在是 ${Array.isArray(rows) ? rows.length : '不是数组'}）`); continue; }
    rows.forEach((r: unknown, y: number) => {
      if (typeof r !== 'string') { errors.push(`${side} 第 ${y + 1} 行不是字符串`); return; }
      const cells = [...r];
      if (cells.length !== GRID) errors.push(`${side} 第 ${y + 1} 行有 ${cells.length} 个字符，要 ${GRID} 个`);
      const bad = cells.findIndex((ch) => ch !== '.' && !(ch in palette));
      if (bad >= 0 && Object.keys(palette).length) errors.push(`${side} 用了调色板里没有的字母 ${cells[bad]}（第 ${y + 1} 行第 ${bad + 1} 个）`);
    });
  }
  const rig = c.rig;
  if (!rig || typeof rig !== 'object') errors.push('rig 要有 legs、eyes、hands');
  else {
    if (!Number.isInteger(rig.legs) || rig.legs < 12 || rig.legs > GRID - 1) errors.push(`rig.legs 要在 12–${GRID - 1}（腿从第几行开始，0 起算；现在是 ${JSON.stringify(rig.legs)}）`);
    const pts = (v: unknown, what: string, min: number, max: number): [number, number][] => {
      if (!Array.isArray(v) || v.length < min || v.length > max) { errors.push(`rig.${what} 要有 ${min}–${max} 个 [x, y]`); return []; }
      const out: [number, number][] = [];
      for (const p of v) {
        if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => Number.isInteger(n) && n >= 0 && n < GRID)) errors.push(`rig.${what} 里的 ${JSON.stringify(p)} 要是 [x, y]，都在 0–${GRID - 1}`);
        else out.push([p[0], p[1]]);
      }
      return out;
    };
    const eyes = pts(rig.eyes, 'eyes', 1, MAX_EYE_PIXELS);
    pts(rig.hands, 'hands', 1, 2);
    if (Array.isArray(c.front) && c.front.length === GRID) {
      for (const [x, y] of eyes) if ([...(c.front[y] ?? '')][x] === '.') errors.push(`眼睛 (${x},${y}) 在 front 上是透明的`);
    }
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    def: {
      v: 1, id: c.id, name, palette, front: [...c.front], back: [...c.back],
      rig: { legs: rig.legs, eyes: rig.eyes.map((p: number[]) => [p[0], p[1]]), hands: rig.hands.map((p: number[]) => [p[0], p[1]]) },
      ...(c.draft === true ? { draft: true } : {}),
    },
  };
}

/** `admin`, `default`, `type:<名>`, `name:<名>` (a name 1–40 characters). */
export function parseAssignTarget(t: unknown): AssignTarget | null {
  if (t === 'admin' || t === 'default') return t;
  if (typeof t !== 'string') return null;
  const m = /^(type|name):(.{1,40})$/.exec(t);
  return m && m[2].trim() ? (`${m[1]}:${m[2].trim()}` as AssignTarget) : null;
}
