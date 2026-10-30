import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { firstLine } from './first-line.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-first-line-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const put = (name: string, text: string) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };

describe('firstLine', () => {
  it('the first line (LF / CRLF / no newline / a line longer than one read / UTF-8 across a read)', async () => {
    expect(await firstLine(put('a', '{"a":1}\n{"b":2}\n'))).toBe('{"a":1}');
    expect(await firstLine(put('b', '{"a":1}\r\nx'))).toBe('{"a":1}');
    expect(await firstLine(put('c', 'only'))).toBe('only');
    const long = 'x'.repeat(64 * 1024 - 1) + '名字'.repeat(1000);
    expect(await firstLine(put('d', long + '\nnext'))).toBe(long);
  });
  it('null for a missing or empty file', async () => {
    expect(await firstLine(path.join(dir, 'nope'))).toBeNull();
    expect(await firstLine(put('e', ''))).toBeNull();
  });
  // on Windows a process can hold 8189 open files: the old readline head leaked one per call and hit EMFILE here
  it('closes its handle: 9000 calls in a row still work', async () => {
    const f = put('f', '{"type":"cw.meta"}\n' + '{"x":1}\n'.repeat(20000));
    for (let i = 0; i < 9000; i++) expect(await firstLine(f)).toBe('{"type":"cw.meta"}');
  }, 120_000);
});
