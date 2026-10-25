import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readZip, readZipFile, makeZip, ZipTooLarge } from './zip.js';

/** The pieces of a zip makeZip wrote: local part, central directory, end record. */
function split(z: Buffer) {
  const end = z.length - 22;
  const cdOff = z.readUInt32LE(end + 16);
  return { locals: z.subarray(0, cdOff), cd: z.subarray(cdOff, end), count: z.readUInt16LE(end + 10) };
}
function join(locals: Buffer, cd: Buffer, count: number) {
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(count, 8); e.writeUInt16LE(count, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(locals.length, 16);
  return Buffer.concat([locals, cd, e]);
}

describe('zip', () => {
  it('round-trips stored and deflated entries, keeps folders in names', () => {
    for (const deflate of [false, true]) {
      const z = readZip(makeZip({ 'a.json': '[1]', 'dir/b.txt': Buffer.from('héllo'.repeat(100)) }, { deflate }));
      expect(z.get('a.json')!.toString()).toBe('[1]');
      expect(z.get('dir/b.txt')!.toString()).toBe('héllo'.repeat(100));
    }
  });
  it('refuses something that is not a zip', () => {
    expect(() => readZip(Buffer.from('not a zip at all'))).toThrow();
  });

  it('a zip bomb is refused: one entry inflating past the per-entry cap, or all of them past the total', () => {
    const bomb = makeZip({ 'conversations.json': Buffer.alloc(8 * 1024 * 1024) }, { deflate: true });
    expect(bomb.length).toBeLessThan(64 * 1024); // tiny on disk
    expect(() => readZip(bomb, { maxEntry: 1024 * 1024 })).toThrow(ZipTooLarge);
    // a header that lies about the size: the inflate itself stops at the cap
    const { locals, cd, count } = split(bomb);
    const liar = Buffer.from(cd); liar.writeUInt32LE(10, 24);
    expect(() => readZip(join(locals, liar, count), { maxEntry: 1024 * 1024 })).toThrow(ZipTooLarge);
    const two = makeZip({ 'a.json': Buffer.alloc(600 * 1024), 'b.json': Buffer.alloc(600 * 1024) }, { deflate: true });
    expect(() => readZip(two, { maxEntry: 1024 * 1024, maxTotal: 1024 * 1024 })).toThrow(ZipTooLarge);
    // the default caps hold too (a lying header can't get past them: the inflate itself is limited)
    expect(readZip(two).get('a.json')!.length).toBe(600 * 1024);
  });

  it('only the wanted entries are inflated: a bomb next to them is never opened', () => {
    const z = makeZip({ 'x/conversations.json': '[]', 'huge.bin': Buffer.alloc(8 * 1024 * 1024) }, { deflate: true });
    const r = readZip(z, { maxEntry: 1024 * 1024, want: (n) => n.endsWith('conversations.json') });
    expect([...r.keys()]).toEqual(['x/conversations.json']);
  });

  it('overlapping entries (two directory records on the same bytes) are refused', () => {
    const { locals, cd, count } = split(makeZip({ 'a.json': '[1,2,3]' }, { deflate: true }));
    const twin = Buffer.from(cd); twin[46] = 'b'.charCodeAt(0); // same local header, another name
    expect(() => readZip(join(locals, Buffer.concat([cd, twin]), count + 1))).toThrow(/overlap/);
    // one entry's header inside another's data
    const z2 = split(makeZip({ 'a.json': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'b.json': 'b' }));
    const cd2 = Buffer.from(z2.cd);
    const second = 46 + 6; // the second record starts after the first (46 + name)
    cd2.writeUInt32LE(30 + 6 + 10, second + 42); // b's header "inside" a's data
    expect(() => readZip(join(z2.locals, cd2, 2))).toThrow();
  });

  it('sizes that do not fit the file are refused', () => {
    const { locals, cd, count } = split(makeZip({ 'a.json': '[1]' }));
    const bad = Buffer.from(cd); bad.writeUInt32LE(10_000_000, 20); bad.writeUInt32LE(10_000_000, 24);
    expect(() => readZip(join(locals, bad, count))).toThrow();
  });

  it('reads from a file without loading it whole (same result)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-zip-'));
    try {
      const f = path.join(dir, 'x.zip');
      fs.writeFileSync(f, makeZip({ 'conversations.json': '[1]', 'other.bin': Buffer.alloc(1000) }, { deflate: true }));
      const r = readZipFile(f, { want: (n) => n === 'conversations.json' });
      expect([...r.keys()]).toEqual(['conversations.json']);
      expect(r.get('conversations.json')!.toString()).toBe('[1]');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
