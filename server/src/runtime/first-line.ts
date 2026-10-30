import fs from 'node:fs/promises';

/**
 * A file's first line (null: missing, or empty). Reads in small blocks and always closes the handle. Do not use
 * readline over createReadStream for this: leaving its loop early (`rl.close()` + return) only pauses the stream,
 * whose file handle then stays open for good — `head()` runs on every list and open, and after 8189 of them Windows
 * refused every open with EMFILE (2026-10-30 user report: 添加供应商 failed on meta.json.<pid>.tmp).
 */
export async function firstLine(file: string, max = 4 << 20): Promise<string | null> {
  let fh: fs.FileHandle;
  try { fh = await fs.open(file, 'r'); } catch { return null; }
  try {
    const parts: Buffer[] = [];
    const buf = Buffer.alloc(64 * 1024);
    for (let pos = 0, total = 0; total < max; ) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      if (!bytesRead) break;
      const nl = buf.subarray(0, bytesRead).indexOf(10);
      parts.push(Buffer.from(buf.subarray(0, nl < 0 ? bytesRead : nl)));
      if (nl >= 0) break;
      pos += bytesRead;
      total += bytesRead;
    }
    const line = Buffer.concat(parts).toString('utf8').replace(/\r$/, '');
    return line || null;
  } finally {
    await fh.close();
  }
}
