import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeHost, VcsTokenStore } from './token-store';

const secrets = { protect: async (p: string) => `enc:plain:${Buffer.from(p).toString('base64')}`, reveal: async (v?: string) => (v ? Buffer.from(v.slice('enc:plain:'.length), 'base64').toString() : '') };

describe('VcsTokenStore', () => {
  it('stores encrypted per host, lists names only, removes', async () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'cw-tok-')), 'vcs-tokens.json');
    const s = new VcsTokenStore(file, secrets);
    await s.set('GitLab.Corp.Example', 'glpat-secret');
    expect(s.hosts()).toEqual(['gitlab.corp.example']);
    expect(await s.get('gitlab.corp.example')).toBe('glpat-secret');
    expect(readFileSync(file, 'utf8')).not.toContain('glpat-secret');
    await s.set('gitlab.corp.example', null);
    expect(s.hosts()).toEqual([]);
    expect(await s.get('gitlab.corp.example')).toBe('');
  });
  it('refuses junk hosts', async () => {
    expect(normalizeHost('git.corp:8443')).toBe('git.corp:8443');
    expect(normalizeHost('https://x/y')).toBeNull();
    expect(normalizeHost('__proto__')).toBeNull();
    const s = new VcsTokenStore(path.join(os.tmpdir(), 'never-written.json'), secrets);
    await expect(s.set('a b', 't')).rejects.toThrow();
  });
});
