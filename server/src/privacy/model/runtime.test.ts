import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { LABELS, PrivacyModel, type PinnedFile } from './index.js';
import { bindingRel, type RuntimePackage } from './runtime.js';

const tmp: string[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const mkdir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ort-')); tmp.push(d); return d; };
const serve = async (files: Record<string, Buffer>) => {
  const s = http.createServer((req, res) => {
    const f = files[decodeURIComponent(new URL(req.url!, 'http://x').pathname)];
    if (!f) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-length': f.length }).end(f);
  });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}/`;
};
const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const sri = (b: Buffer) => `sha512-${crypto.createHash('sha512').update(b).digest('base64')}`;

/** A .tar.gz of ustar entries (type '0' file unless given). */
function tgz(entries: { name: string; data?: string | Buffer; type?: string; link?: string }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? '');
    const h = Buffer.alloc(512);
    h.write(e.name, 0, 100, 'utf8');
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write('00000000000\0', 136);
    h.write(e.type ?? '0', 156);
    if (e.link) h.write(e.link, 157, 100);
    h.write('ustar\0', 257);
    h.write('00', 263);
    h.fill(32, 148, 156);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

// a tokenizer of a few pieces (ids 6 / 7 = Rina / Kowalczyk), and a fake onnxruntime that calls those two a person
const NO_MAP = Buffer.from([4, 0, 0, 0, 0, 0, 0, 0]).toString('base64');
const tokenizer = Buffer.from(JSON.stringify({
  normalizer: { type: 'Precompiled', precompiled_charsmap: NO_MAP },
  added_tokens: [{ id: 0, content: '<s>', special: true }, { id: 2, content: '</s>', special: true }],
  model: { type: 'Unigram', unk_id: 3, vocab: [['<s>', 0], ['<pad>', 0], ['</s>', 0], ['<unk>', 0], ['▁', -2], ['▁ask', -1], ['▁Rina', -1], ['▁Kowalczyk', -1], ['▁about', -1], ['▁it', -1]] },
}));
const onnx = Buffer.from('onnx');
const MODEL_FILES: PinnedFile[] = [{ path: 'int8/tokenizer.json', size: tokenizer.length, sha256: sha256(tokenizer) }, { path: 'int8/model_int8.onnx', size: onnx.length, sha256: sha256(onnx) }];

const FAKE_ORT = `
const common = require('onnxruntime-common');
const K = ${LABELS.length}, B = ${LABELS.indexOf('B-private_person')}, I = ${LABELS.indexOf('I-private_person')};
class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
exports.Tensor = Tensor;
exports.InferenceSession = { create: async () => ({
  inputNames: ['input_ids', 'attention_mask'], outputNames: ['logits'],
  run: async (feeds) => {
    const ids = Array.from(feeds.input_ids.data, Number);
    const out = new Float32Array(ids.length * K);
    ids.forEach((id, i) => { out[i * K + (id === 6 ? B : id === 7 ? I : 0)] = 10; });
    return { logits: { data: out } };
  },
}) };
exports.fake = common.marker;
`;
const plat = `package/${bindingRel(process.platform, process.arch)}`;
const other = `package/${bindingRel(process.platform === 'linux' ? 'win32' : 'linux', 'x64')}`;
const ortTgz = (extra: { name: string; data?: string; type?: string; link?: string }[] = []) => tgz([
  { name: 'package/package.json', data: JSON.stringify({ name: 'onnxruntime-node', version: '9.9.9', main: 'dist/index.js' }) },
  { name: 'package/dist/index.js', data: FAKE_ORT },
  { name: 'package/lib/index.ts', data: 'source, not kept' },
  { name: plat, data: 'native' },
  { name: other, data: 'another platform' },
  ...extra,
]);
const commonTgz = tgz([
  { name: 'package/package.json', data: JSON.stringify({ name: 'onnxruntime-common', version: '9.9.9', main: 'index.js' }) },
  { name: 'package/index.js', data: 'exports.marker = 42;' },
]);

async function setup(ortBytes: Buffer, o: { integrity?: string } = {}) {
  const base = await serve({
    '/onnxruntime-node/-/onnxruntime-node-9.9.9.tgz': ortBytes,
    '/onnxruntime-common/-/onnxruntime-common-9.9.9.tgz': commonTgz,
    '/m/rev1/int8/tokenizer.json': tokenizer,
    '/m/rev1/int8/model_int8.onnx': onnx,
  });
  const packages: RuntimePackage[] = [
    { name: 'onnxruntime-node', version: '9.9.9', size: ortBytes.length, integrity: o.integrity ?? sri(ortBytes) },
    { name: 'onnxruntime-common', version: '9.9.9', size: commonTgz.length, integrity: sri(commonTgz) },
  ];
  const root = mkdir();
  const m = new PrivacyModel(root, { files: MODEL_FILES, base: `${base}m/`, rev: 'rev1', appRuntime: () => false, ort: { registry: base, packages, fetchImpl: fetch } });
  return { m, root };
}

describe('the downloadable onnxruntime', () => {
  it('one download fetches the runtime and the model; the model runs without a restart; remove takes both', async () => {
    const { m, root } = await setup(ortTgz());
    expect(m.status()).toMatchObject({ runtime: false, installed: false });
    expect(m.status().runtimeSize).toBeGreaterThan(0);
    await expect(m.find(['ask Rina Kowalczyk'], 0.8)).rejects.toThrow();
    await m.download();
    expect(m.status().error).toBeUndefined();
    expect(m.status()).toMatchObject({ runtime: true, runtimeOwn: true, installed: true });
    const nm = path.join(root, 'runtime', 'node_modules');
    // only this machine's binaries and the JS (not other platforms', not the sources)
    expect(fs.existsSync(path.join(nm, 'onnxruntime-node', plat.slice('package/'.length)))).toBe(true);
    expect(fs.existsSync(path.join(nm, 'onnxruntime-node', other.slice('package/'.length)))).toBe(false);
    expect(fs.existsSync(path.join(nm, 'onnxruntime-node', 'lib'))).toBe(false);
    expect(fs.existsSync(path.join(nm, 'onnxruntime-common', 'index.js'))).toBe(true);
    expect(fs.readdirSync(root).filter((n) => n.startsWith('runtime.'))).toEqual([]);
    const [got] = await m.find(['ask Rina Kowalczyk about it'], 0.8);
    expect(got).toEqual([{ start: 4, end: 18, category: 'name' }]);
    expect(m.status().loaded).toBe(true);

    await m.remove();
    expect(fs.existsSync(path.join(root, 'runtime'))).toBe(false);
    expect(fs.existsSync(m.dir()!)).toBe(false);
    expect(m.status()).toMatchObject({ runtime: false, installed: false });
  });

  it('a tarball that does not match the published integrity is refused and leaves nothing behind', async () => {
    const bytes = ortTgz();
    const { m, root } = await setup(bytes, { integrity: sri(Buffer.from('something else')) });
    await m.download();
    expect(m.status().error).toMatch(/SHA-512/);
    expect(m.status()).toMatchObject({ runtime: false, installed: false });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('a path that climbs out of the folder is refused, nothing is written', async () => {
    const { m, root } = await setup(ortTgz([{ name: 'package/../../evil.js', data: 'x' }]));
    await m.download();
    expect(m.status().error).toMatch(/不安全|unsafe/i);
    expect(fs.readdirSync(root)).toEqual([]);
    expect(fs.existsSync(path.join(path.dirname(root), 'evil.js'))).toBe(false);
  });

  it('a link entry is refused', async () => {
    const { m, root } = await setup(ortTgz([{ name: 'package/dist/link.js', type: '2', link: '/etc/passwd' }]));
    await m.download();
    expect(m.status().error).toBeTruthy();
    expect(m.status().runtime).toBe(false);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('a package without this machine\'s binary is not installed', async () => {
    const bytes = tgz([
      { name: 'package/package.json', data: JSON.stringify({ name: 'onnxruntime-node', main: 'dist/index.js' }) },
      { name: 'package/dist/index.js', data: FAKE_ORT },
      { name: other, data: 'another platform' },
    ]);
    const { m, root } = await setup(bytes);
    await m.download();
    expect(m.status().error).toBeTruthy();
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
