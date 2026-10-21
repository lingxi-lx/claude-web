import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MetaStore } from '../meta/store.js';
import { SecretService } from '../secrets/service.js';
import { GatewayKeyStore } from './keys.js';

async function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-keys-'));
  const meta = new MetaStore(path.join(dir, 'meta.json'));
  await meta.load();
  return { meta, store: new GatewayKeyStore(meta, new SecretService()) };
}

describe('GatewayKeyStore', () => {
  it('mints a cwg- key and verifies it without storing plaintext', async () => {
    const { meta, store } = await make();
    const { key, plaintext } = await store.create(undefined, 'test');
    expect(plaintext.startsWith('cwg-')).toBe(true);
    expect(key.hash).toHaveLength(64);
    expect(JSON.stringify(meta.data)).not.toContain(plaintext);
    expect(store.verify(plaintext)?.key.id).toBe(key.id);
    expect(store.verify('cwg-nope')).toBeNull();
  });

  it('migrates the legacy key into the default group and keeps it revealable', async () => {
    const { store } = await make();
    await store.migrateLegacy('cwg-legacy-secret');
    const hit = store.verify('cwg-legacy-secret');
    expect(hit?.group.id).toBe('default');
    expect(await store.reveal(hit!.key.id)).toBe('cwg-legacy-secret');
    // migrating twice does not mint a second row
    await store.migrateLegacy('cwg-legacy-secret');
    expect(store.list()).toHaveLength(1);
  });

  it('enforces daily token budgets', async () => {
    const { store } = await make();
    const { key } = await store.create(undefined, 'budget', { rateLimit: { dailyTokens: 100 } });
    const g = store.group(key.keyGroupId)!;
    expect(store.canSpend(key, g)).toEqual({ ok: true });
    store.recordUsage(key.id, 60, 50, 0);
    expect(store.canSpend(store.list().find((k) => k.id === key.id)!, g)).toMatchObject({ ok: false });
  });

  it('rejects disabled and expired keys', async () => {
    const { store } = await make();
    const { key, plaintext } = await store.create(undefined, 'x', { expiresAt: Date.now() - 1 });
    expect(store.verify(plaintext)).toBeNull();
    await store.update(key.id, { enabled: false, expiresAt: null });
    expect(store.verify(plaintext)).toBeNull();
  });

  it('refuses to delete the migrated default key', async () => {
    const { store } = await make();
    await store.migrateLegacy('cwg-old');
    await expect(store.remove('key_default')).rejects.toThrow(/默认密钥/);
    expect(store.list()).toHaveLength(1);
  });

  it('replaces the legacy key in place on regenerate', async () => {
    const { store } = await make();
    await store.migrateLegacy('cwg-old');
    await store.replaceLegacy('cwg-new');
    expect(store.verify('cwg-old')).toBeNull();
    expect(store.verify('cwg-new')?.key.id).toBe('key_default');
    expect(await store.reveal('key_default')).toBe('cwg-new');
  });
});
