// The secret half of a sync bundle: a key derived from the user's passphrase (scrypt) and AES-256-GCM.
// The passphrase is never stored; a wrong one fails the GCM tag check (no partial plaintext).
import crypto from 'node:crypto';
import { tr } from '../i18n/index.js';

export interface SealedBox {
  alg: 'aes-256-gcm';
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

const N = 1 << 15;
const R = 8;
const P = 1;
const MAXMEM = 128 * N * R * 2;
const MIN_PASSPHRASE = 8;

function derive(passphrase: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(passphrase.normalize('NFKC'), salt, 32, { N: n, r, p, maxmem: Math.max(MAXMEM, 128 * n * r * 2) }, (e, k) => (e ? reject(e) : resolve(k)));
  });
}

export function checkPassphrase(passphrase: string): void {
  if (typeof passphrase !== 'string' || [...passphrase].length < MIN_PASSPHRASE) throw new Error(tr('口令至少 {n} 个字', { n: MIN_PASSPHRASE }));
}

export async function seal(plain: string, passphrase: string, aad = 'claude-web-sync/1'): Promise<SealedBox> {
  checkPassphrase(passphrase);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await derive(passphrase, salt, N, R, P);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { alg: 'aes-256-gcm', kdf: 'scrypt', N, r: R, p: P, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export async function open(box: SealedBox, passphrase: string, aad = 'claude-web-sync/1'): Promise<string> {
  if (box?.alg !== 'aes-256-gcm' || box.kdf !== 'scrypt') throw new Error(tr('不认识的加密方式'));
  // bounded cost: a crafted file must not make us burn gigabytes
  if (!(box.N >= 1024 && box.N <= 1 << 20 && box.r >= 1 && box.r <= 16 && box.p >= 1 && box.p <= 4)) throw new Error(tr('不认识的加密方式'));
  const key = await derive(passphrase, Buffer.from(box.salt, 'base64'), box.N, box.r, box.p);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  try {
    return Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8');
  } catch {
    throw new Error(tr('口令不对，或者文件损坏了'));
  }
}
