import { describe, expect, it } from 'vitest';
import { ADMIN, BOWL, BUILTIN, FRAME, GRID, OCTOPUS, parseAssignTarget, poseFrame, resolveCharacter, shadeHex, skin, tinted, validateCharacter, withoutCharacter, type Frame } from './index.js';

const ok = () => {
  const c = JSON.parse(JSON.stringify(OCTOPUS));
  delete c.builtin;
  c.id = 'x';
  return c;
};
const at = (f: Frame, x: number, y: number) => f.px[y * f.w + x];

describe('validateCharacter', () => {
  it('accepts the built-ins', () => {
    for (const b of BUILTIN) expect(validateCharacter({ ...b, id: 'copy' }).ok).toBe(true);
  });
  it('says which row is the wrong length', () => {
    const c = ok();
    c.front[2] = c.front[2].slice(1);
    const r = validateCharacter(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain('front 第 3 行有 23 个字符');
  });
  it('rejects a letter not in the palette, a bad colour, an id with capitals, legs out of range, a transparent eye', () => {
    const c = ok();
    c.front[4] = 'q' + c.front[4].slice(1);
    c.palette.k = '#12345';
    c.id = 'Bad';
    c.rig.legs = 3;
    c.rig.eyes = [[0, 0]];
    const r = validateCharacter(c);
    expect(r.ok).toBe(false);
    if (!r.ok) for (const s of ['字母 q', '#12345', 'id', 'legs', '(0,0)']) expect(r.errors.join('\n')).toContain(s);
  });
  it('rejects non-objects, more than 16 colours, a missing back', () => {
    expect(validateCharacter(null).ok).toBe(false);
    expect(validateCharacter([]).ok).toBe(false);
    const c = ok();
    for (let i = 0; i < 17; i++) c.palette['ABCDEFGHIJKLMNOPQ'[i]] = '#000000';
    expect(validateCharacter(c).ok).toBe(false);
    const d = ok();
    delete d.back;
    expect(validateCharacter(d).ok).toBe(false);
  });
  it('keeps only what it knows, lowercases colours, keeps draft', () => {
    const c = ok();
    c.palette.o = '#ABCDEF';
    c.extra = 'x';
    c.draft = true;
    const r = validateCharacter(c);
    expect(r.ok && r.def.palette.o).toBe('#abcdef');
    expect(r.ok && (r.def as any).extra).toBeUndefined();
    expect(r.ok && r.def.draft).toBe(true);
    expect(r.ok && r.def.builtin).toBeUndefined();
  });
  it('parses assign targets', () => {
    expect(parseAssignTarget('admin')).toBe('admin');
    expect(parseAssignTarget('type:Explore')).toBe('type:Explore');
    expect(parseAssignTarget('name: researcher ')).toBe('name:researcher');
    expect(parseAssignTarget('everyone')).toBeNull();
    expect(parseAssignTarget('type:')).toBeNull();
  });
});

describe('poseFrame', () => {
  it('is 26 × 26 and the stand frame is the front picture moved by one', () => {
    const f = poseFrame(OCTOPUS, 'se', 'stand', 0);
    expect([f.w, f.h]).toEqual([FRAME, FRAME]);
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const ch = OCTOPUS.front[y][x];
      expect(at(f, x + 1, y + 1)).toBe(ch === '.' ? null : OCTOPUS.palette[ch]);
    }
  });
  it('sw mirrors se, nw mirrors ne, ne is the back', () => {
    const a = poseFrame(OCTOPUS, 'se', 'stand', 0), b = poseFrame(OCTOPUS, 'sw', 'stand', 0);
    for (let y = 0; y < FRAME; y++) for (let x = 0; x < FRAME; x++) expect(at(b, x, y)).toBe(at(a, FRAME - 1 - x, y));
    expect(poseFrame(OCTOPUS, 'ne', 'stand', 0).px).not.toContain('#ffffff');
  });
  it('walk frames differ and repeat every 4 ticks', () => {
    const f = (t: number) => JSON.stringify(poseFrame(OCTOPUS, 'se', 'walk', t).px);
    expect(f(0)).not.toBe(f(1));
    expect(f(1)).not.toBe(f(3));
    expect(f(0)).toBe(f(4));
  });
  it('sitting hides the legs rows', () => {
    for (const pose of ['sit', 'type', 'game'] as const) {
      const f = poseFrame(OCTOPUS, 'se', pose, 0);
      for (let y = OCTOPUS.rig.legs + 1 + 2; y < FRAME; y++) for (let x = 0; x < FRAME; x++) expect(at(f, x, y)).toBeNull();
    }
  });
  it('typing moves the hands', () => {
    expect(JSON.stringify(poseFrame(OCTOPUS, 'se', 'type', 0).px)).not.toBe(JSON.stringify(poseFrame(OCTOPUS, 'se', 'type', 2).px));
    expect(JSON.stringify(poseFrame(OCTOPUS, 'se', 'game', 0).px)).not.toBe(JSON.stringify(poseFrame(OCTOPUS, 'se', 'game', 1).px));
  });
  it('eat puts a bowl at the first hand', () => {
    const [hx, hy] = OCTOPUS.rig.hands[0];
    expect(at(poseFrame(OCTOPUS, 'se', 'eat', 0), hx + 1, hy + 2)).toBe(BOWL);
  });
  it('blink paints the eyes in the skin colour', () => {
    const [ex, ey] = OCTOPUS.rig.eyes[0];
    expect(skin(OCTOPUS)).toBe(OCTOPUS.palette.o);
    expect(at(poseFrame(OCTOPUS, 'se', 'blink', 0), ex + 1, ey + 1)).toBe(OCTOPUS.palette.o);
  });
});

describe('assign', () => {
  const has = (ids: string[]) => (id: string) => ids.includes(id);
  const a = { admin: 'boss', default: 'dflt', byType: { Explore: 'cat' }, byName: { researcher: 'dog' } };
  it('name beats type beats default; the admin by itself', () => {
    const e = has(['boss', 'dflt', 'cat', 'dog']);
    expect(resolveCharacter(a, { name: 'researcher', type: 'Explore' }, e)).toBe('dog');
    expect(resolveCharacter(a, { name: 'x', type: 'Explore' }, e)).toBe('cat');
    expect(resolveCharacter(a, { name: 'x' }, e)).toBe('dflt');
    expect(resolveCharacter(a, { admin: true }, e)).toBe('boss');
  });
  it('skips missing ids, falls back to the built-ins', () => {
    expect(resolveCharacter(a, { name: 'researcher', type: 'Explore' }, has(['cat']))).toBe('cat');
    expect(resolveCharacter(a, { name: 'x' }, has([]))).toBe('octopus');
    expect(resolveCharacter(undefined, { admin: true }, has([]))).toBe('admin');
  });
  it('a deleted id leaves every assignment', () => {
    expect(withoutCharacter(a, 'cat')).toEqual({ admin: 'boss', default: 'dflt', byType: {}, byName: { researcher: 'dog' } });
    expect(withoutCharacter(a, 'boss').admin).toBeUndefined();
  });
  it('tints only the octopus', () => {
    const t = tinted(OCTOPUS, '#3366cc');
    expect(t.palette.o).toBe('#3366cc');
    expect(t.palette.h).toBe(shadeHex('#3366cc', 0.28));
    expect(t.palette.k).toBe(OCTOPUS.palette.k);
    expect(tinted(ADMIN, '#3366cc')).toBe(ADMIN);
    expect(tinted(OCTOPUS, 'var(--x)')).toBe(OCTOPUS);
  });
});
