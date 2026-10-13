import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { CharacterService, handleCharacters, isCharactersRequest } from './service.js';
import { encodePng } from './png.js';
import { previewPng, PREVIEW_CELLS, PREVIEW_SCALE } from './preview.js';
import { FRAME, OCTOPUS, type CafeAssign } from './core/index.js';

const mine = (id = 'mimi') => {
  const c: any = JSON.parse(JSON.stringify(OCTOPUS));
  delete c.builtin;
  return { ...c, id, name: '咪咪' };
};

describe('png', () => {
  it('encodes RGBA rows with filter 0', () => {
    const px = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 1, 2, 3, 4]);
    const png = encodePng(2, 2, px);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(2);
    const idatAt = png.indexOf('IDAT');
    const len = png.readUInt32BE(idatAt - 4);
    const raw = zlib.inflateSync(png.subarray(idatAt + 4, idatAt + 4 + len));
    expect([...raw]).toEqual([0, ...px.slice(0, 8), 0, ...px.slice(8)]);
  });
  it('a preview has one cell per pose, 8 ×', () => {
    const png = previewPng(OCTOPUS);
    expect(png.readUInt32BE(16)).toBe(PREVIEW_CELLS.length * (FRAME + 1) * PREVIEW_SCALE);
    expect(png.readUInt32BE(20)).toBe(FRAME * PREVIEW_SCALE);
  });
});

describe('CharacterService', () => {
  let dir: string;
  let assign: CafeAssign | undefined;
  let svc: CharacterService;
  let changes: number;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-chars-'));
    assign = undefined;
    svc = new CharacterService(dir, { get: () => assign, set: (a) => { assign = a; } });
    changes = 0;
    svc.on('changed', () => changes++);
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it('lists the built-ins, then saved and draft ones', async () => {
    expect((await svc.list()).map((c) => c.id)).toEqual(['octopus', 'admin']);
    const r = await svc.save(mine(), true);
    expect(r.ok).toBe(true);
    const got = await svc.get('mimi');
    expect(got?.draft).toBe(true);
    expect(changes).toBe(1);
  });
  it('refuses a bad character without writing, and a built-in id', async () => {
    const bad = mine();
    bad.front = bad.front.slice(1);
    const r = await svc.save(bad, true);
    expect(r.ok).toBe(false);
    expect(await fs.readdir(dir)).toEqual([]);
    expect((await svc.save(mine('octopus'), false)).ok).toBe(false);
    expect(changes).toBe(0);
  });
  it('publishes a draft, assigns it, and a deleted one leaves the assignments', async () => {
    await svc.save(mine(), true);
    await expect(svc.assign('mimi', 'type:Explore')).rejects.toThrow('草稿');
    expect((await svc.publish('mimi')).ok).toBe(true);
    expect((await svc.get('mimi'))?.draft).toBeUndefined();
    await svc.assign('mimi', 'type:Explore');
    await svc.assign('mimi', 'admin');
    expect(assign).toEqual({ byType: { Explore: 'mimi' }, admin: 'mimi' });
    await svc.assign(null, 'admin');
    expect(assign?.admin).toBeUndefined();
    await expect(svc.assign('nobody', 'default')).rejects.toThrow('没有');
    await expect(svc.assign('mimi', 'everyone' as any)).rejects.toThrow('给谁');
    expect(await svc.remove('mimi')).toBe(true);
    expect(assign).toEqual({ byType: {} });
    expect(await svc.remove('octopus')).toBe(false);
  });
  it('skips a file that does not parse or does not match its name', async () => {
    await fs.writeFile(path.join(dir, 'broken.json'), '{ half');
    await fs.writeFile(path.join(dir, 'other.json'), JSON.stringify(mine('mimi')));
    expect((await svc.list()).map((c) => c.id)).toEqual(['octopus', 'admin']);
  });
  it('requests: list for anyone, changes only from this machine', async () => {
    expect(isCharactersRequest({ kind: 'characters.save' })).toBe(true);
    expect(isCharactersRequest({ kind: 'background.list' })).toBe(false);
    expect(await handleCharacters(svc, { kind: 'characters.list' }, true)).toMatchObject({ assign: {} });
    await expect(handleCharacters(svc, { kind: 'characters.save', character: mine() }, true)).rejects.toThrow('本机');
    expect(await handleCharacters(svc, { kind: 'characters.save', character: mine() }, false)).toMatchObject({ ok: true });
  });
});
