// A small read-only zip reader (and a writer for tests / fixtures): enough for claude.ai's data export (stage F4) without
// a dependency. Stored and deflated entries, zip64 sizes / offsets; anything else is skipped.
//
// The export comes from outside, so the reader is defensive (fix wave F1): it reads a file by offsets (never whole),
// inflates only the entries asked for, each with a hard output limit and a total limit (a zip bomb stops at the
// limit, whatever its headers claim), and refuses directories whose entries overlap or point past the end of the file.
import fs from 'node:fs';
import zlib from 'node:zlib';

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;
const Z64_LOC = 0x07064b50;
const Z64_EOCD = 0x06064b50;

export const ZIP_MAX_ENTRY = 512 * 1024 * 1024;
export const ZIP_MAX_TOTAL = 512 * 1024 * 1024;
const MAX_DIRECTORY = 64 * 1024 * 1024;

/** An entry (or all of them together) would inflate past the limit. */
export class ZipTooLarge extends Error {
  constructor(name: string) { super(`zip entry too large: ${name}`); this.name = 'ZipTooLarge'; }
}

export interface ZipLimits {
  /** Only these entries are read and inflated (default: every file). */
  want?: (name: string) => boolean;
  /** Bytes one entry may inflate to (default 512 MB). */
  maxEntry?: number;
  /** Bytes all read entries together may inflate to (default 512 MB). */
  maxTotal?: number;
}

/** Random access to the zip's bytes: a buffer, or a file read by offsets. */
interface Source { size: number; read(pos: number, len: number): Buffer }

const bufferSource = (buf: Buffer): Source => ({
  size: buf.length,
  read: (pos, len) => {
    if (pos < 0 || len < 0 || pos + len > buf.length) throw new Error('broken zip: past the end of the file');
    return buf.subarray(pos, pos + len);
  },
});

function readFrom(src: Source, o: ZipLimits): Map<string, Buffer> {
  const maxEntry = o.maxEntry ?? ZIP_MAX_ENTRY;
  const maxTotal = o.maxTotal ?? ZIP_MAX_TOTAL;
  if (src.size < 22) throw new Error('not a zip file');
  const tailLen = Math.min(src.size, 22 + 0xffff + 20);
  const tailPos = src.size - tailLen;
  const tail = src.read(tailPos, tailLen);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === EOCD) { end = i; break; }
  if (end < 0) throw new Error('not a zip file');
  let count = tail.readUInt16LE(end + 10);
  let cdSize = tail.readUInt32LE(end + 12);
  let cdOffset = tail.readUInt32LE(end + 16);
  // zip64: the locator sits right before the classic end record
  if ((count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) && end >= 20 && tail.readUInt32LE(end - 20) === Z64_LOC) {
    const z = Number(tail.readBigUInt64LE(end - 20 + 8));
    const rec = src.read(z, 56);
    if (rec.readUInt32LE(0) === Z64_EOCD) {
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
  }
  if (cdSize > MAX_DIRECTORY || cdOffset + cdSize > src.size) throw new Error('broken zip directory');
  const cd = src.read(cdOffset, cdSize);

  interface Entry { name: string; method: number; csize: number; usize: number; loc: number }
  const entries: Entry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CEN) throw new Error('broken zip directory');
    const method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20);
    let usize = cd.readUInt32LE(p + 24);
    const nlen = cd.readUInt16LE(p + 28);
    const xlen = cd.readUInt16LE(p + 30);
    const clen = cd.readUInt16LE(p + 32);
    let loc = cd.readUInt32LE(p + 42);
    if (p + 46 + nlen + xlen + clen > cd.length) throw new Error('broken zip directory');
    const name = cd.subarray(p + 46, p + 46 + nlen).toString('utf8');
    // zip64 extra field (id 1): the 0xffffffff values, in order
    let x = p + 46 + nlen;
    const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = cd.readUInt16LE(x);
      const len = cd.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        const lim = Math.min(x + 4 + len, xend);
        if (usize === 0xffffffff && q + 8 <= lim) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff && q + 8 <= lim) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (loc === 0xffffffff && q + 8 <= lim) { loc = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + len;
    }
    p = xend + clen;
    if (name.endsWith('/')) continue;
    entries.push({ name, method, csize, usize, loc });
  }

  // every entry's bytes (local header + name + extra + data) must lie inside the file, before the directory, and
  // not overlap another entry's — that is how small zips claim to hold terabytes
  const spans = entries.map((e) => {
    if (e.loc + 30 > cdOffset) throw new Error('broken zip entry');
    const h = src.read(e.loc, 30);
    if (h.readUInt32LE(0) !== LOC) throw new Error('broken zip entry');
    const start = e.loc + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
    if (start + e.csize > cdOffset) throw new Error('broken zip entry: past the end of the data');
    return { e, start, stop: start + e.csize };
  }).sort((a, b) => a.e.loc - b.e.loc);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].e.loc < spans[i - 1].stop) throw new Error('broken zip: entries overlap');
  }

  const out = new Map<string, Buffer>();
  let total = 0;
  for (const { e, start } of spans) {
    if (o.want && !o.want(e.name)) continue;
    if (e.method !== 0 && e.method !== 8) continue; // other methods (bzip2, lzma, encrypted…): skipped
    const room = Math.min(maxEntry, maxTotal - total);
    if (room <= 0 || (e.method === 0 ? e.csize : e.usize) > room) throw new ZipTooLarge(e.name);
    const data = src.read(start, e.csize);
    let raw: Buffer;
    if (e.method === 0) raw = Buffer.from(data);
    else {
      // the header's size may lie: the inflate itself stops at the limit
      try { raw = zlib.inflateRawSync(data, { maxOutputLength: room }); } catch (err: any) {
        if (err?.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) throw new ZipTooLarge(e.name);
        throw err;
      }
    }
    total += raw.length;
    out.set(e.name, raw);
  }
  return out;
}

export function readZip(buf: Buffer, o: ZipLimits = {}): Map<string, Buffer> {
  return readFrom(bufferSource(buf), o);
}

/** The same, reading the file by offsets: only the directory and the wanted entries are ever in memory. */
export function readZipFile(file: string, o: ZipLimits = {}): Map<string, Buffer> {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    return readFrom({
      size,
      read: (pos, len) => {
        if (pos < 0 || len < 0 || pos + len > size) throw new Error('broken zip: past the end of the file');
        const b = Buffer.alloc(len);
        let got = 0;
        while (got < len) {
          const n = fs.readSync(fd, b, got, len - got, pos + got);
          if (n <= 0) throw new Error('broken zip: short read');
          got += n;
        }
        return b;
      },
    }, o);
  } finally {
    fs.closeSync(fd);
  }
}

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(b: Buffer): number {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** A zip of `entries` (tests and e2e fixtures). */
export function makeZip(entries: Record<string, string | Buffer>, o: { deflate?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const cens: Buffer[] = [];
  let offset = 0;
  for (const [name, v] of Object.entries(entries)) {
    const raw = Buffer.isBuffer(v) ? v : Buffer.from(v, 'utf8');
    const data = o.deflate ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(LOC, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(o.deflate ? 8 : 0, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nameBuf.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(CEN, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(o.deflate ? 8 : 0, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(h, nameBuf, data);
    cens.push(c, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(cens);
  const e = Buffer.alloc(22);
  const n = Object.keys(entries).length;
  e.writeUInt32LE(EOCD, 0); e.writeUInt16LE(n, 8); e.writeUInt16LE(n, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}
