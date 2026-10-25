// A small read-only zip reader (and a writer for tests / fixtures): enough for claude.ai's data export (stage F4) without
// a dependency. Stored and deflated entries, zip64 sizes / offsets; anything else is skipped.
import zlib from 'node:zlib';

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;
const Z64_LOC = 0x07064b50;
const Z64_EOCD = 0x06064b50;

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === EOCD) return i;
  return -1;
}

export function readZip(buf: Buffer): Map<string, Buffer> {
  const end = findEocd(buf);
  if (end < 0) throw new Error('not a zip file');
  let count = buf.readUInt16LE(end + 10);
  let cdOffset = buf.readUInt32LE(end + 16);
  // zip64: the locator sits right before the classic end record
  if ((count === 0xffff || cdOffset === 0xffffffff) && end >= 20 && buf.readUInt32LE(end - 20) === Z64_LOC) {
    const z = Number(buf.readBigUInt64LE(end - 20 + 8));
    if (buf.readUInt32LE(z) === Z64_EOCD) {
      count = Number(buf.readBigUInt64LE(z + 32));
      cdOffset = Number(buf.readBigUInt64LE(z + 48));
    }
  }
  const out = new Map<string, Buffer>();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN) throw new Error('broken zip directory');
    const method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20);
    let usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    let loc = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    // zip64 extra field (id 1): the 0xffffffff values, in order
    let x = p + 46 + nlen;
    const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = buf.readUInt16LE(x);
      const len = buf.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (loc === 0xffffffff) { loc = Number(buf.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + len;
    }
    p = xend + clen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(loc) !== LOC) throw new Error('broken zip entry');
    const start = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
    const data = buf.subarray(start, start + csize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, zlib.inflateRawSync(data));
    // other methods (bzip2, lzma, encrypted…): skipped
    void usize;
  }
  return out;
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
