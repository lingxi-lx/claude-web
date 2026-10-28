// Test-only builders for structurally valid reasoning signatures (protobuf by hand), shared by
// signature.test.ts and replay-cache.test.ts. Lives under __mocks__ so the server build skips it.
import crypto from 'node:crypto';

const varint = (n: number) => { const out: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };
const tag = (num: number, type: number) => varint((num << 3) | type);
const bytesField = (num: number, b: Buffer) => Buffer.concat([tag(num, 2), varint(b.length), b]);
const varintField = (num: number, v: number) => Buffer.concat([tag(num, 0), varint(v)]);

/** Claude `E…`: 0x12 · field 2 { field 1 { channel_id, field2, opaque bytes } }. */
export function claudeSig(): string {
  const channel = Buffer.concat([varintField(1, 11), varintField(2, 1), bytesField(3, crypto.randomBytes(48))]);
  return bytesField(2, bytesField(1, channel)).toString('base64'); // 0x12… → 'E…'
}
/** Claude `R…`: base64 of the `E…` string. */
export const claudeDouble = (e: string) => Buffer.from(e, 'latin1').toString('base64');
/** Claude CAIS `C…`: 0x08 version · field 2 { field 1 { channel, signature bytes, model_text } }. */
export function caisSig(): string {
  const channel = Buffer.concat([varintField(1, 12), bytesField(5, crypto.randomBytes(32)), bytesField(6, Buffer.from('claude-opus-4-5'))]);
  return Buffer.concat([varintField(1, 3), bytesField(2, bytesField(1, channel))]).toString('base64');
}
/** Gemini field-2 envelope around a 0x01 Tink payload. */
export function geminiSig(): string {
  const inner = Buffer.concat([Buffer.from([0x01]), crypto.randomBytes(40)]);
  return bytesField(2, bytesField(1, inner)).toString('base64');
}
/** Fernet: version 0x80 · 8-byte timestamp (high bytes zero → `gAAAA…`) · 16 IV · AES blocks · 32 HMAC. */
export function fernet(): string {
  const d = Buffer.concat([Buffer.from([0x80, 0, 0, 0, 0]), crypto.randomBytes(4 + 16 + 32 + 32)]);
  return d.toString('base64url');
}
/** xAI: unpadded std base64 of high-entropy bytes. */
export function grokSig(): string { return crypto.randomBytes(256).toString('base64').replace(/=+$/, ''); }
/** Kimi: 4340 chars of unpadded std base64 that does not start like a self-describing envelope. */
export function kimiSig(): string {
  for (;;) {
    const s = crypto.randomBytes(3255).toString('base64').replace(/=+$/, '').slice(0, 4340);
    if (!'ACEQRg'.includes(s[0])) return s;
  }
}
