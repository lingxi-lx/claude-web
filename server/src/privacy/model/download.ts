// A download checked against a pinned size and hash: streamed to `.part`, checked, then renamed; a mismatch is deleted.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tr } from '../../i18n/index.js';

/** Exactly `size` bytes, and either a SHA-256 (hex) or an SRI integrity string (`sha512-<base64>`, as npm publishes). */
export interface Expected { size: number; sha256?: string; integrity?: string }

export async function fetchVerified(url: string, dest: string, want: Expected, o: { signal?: AbortSignal; onBytes?: (n: number) => void; fetchImpl?: typeof fetch } = {}): Promise<void> {
  const sri = want.integrity ? /^(sha512|sha384|sha256)-([A-Za-z0-9+/=]+)$/.exec(want.integrity) : null;
  if (!want.sha256 && !sri) throw new Error('no pinned hash');
  const part = `${dest}.part`;
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const res = await (o.fetchImpl ?? fetch)(url, { signal: o.signal, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const hash = crypto.createHash(sri ? sri[1] : 'sha256');
  const out = fs.createWriteStream(part, { mode: 0o600 });
  let n = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      n += chunk.length;
      if (n > want.size) throw new Error(tr('文件比预期的大'));
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
      o.onBytes?.(n);
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
    if (sri) {
      if (n !== want.size || hash.digest('base64') !== sri[2]) throw new Error(tr('校验不通过（和 npm 公布的 {algo} 不符），文件已删除', { algo: sri[1].toUpperCase().replace('SHA', 'SHA-') }));
    } else if (n !== want.size || hash.digest('hex') !== want.sha256) throw new Error(tr('校验不通过（SHA-256 不符），文件已删除'));
    await fs.promises.rename(part, dest);
  } catch (e) {
    // the stream opens its file asynchronously: a failure on the first chunk can come before the open, and an rm
    // then would run before the file exists — wait until it is closed, then remove it
    const closed = out.closed ? Promise.resolve() : new Promise<void>((r) => out.once('close', () => r()));
    out.destroy();
    await closed;
    await fs.promises.rm(part, { force: true }).catch(() => {});
    throw e;
  }
}
