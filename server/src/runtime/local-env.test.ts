import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalEnvStore, envNameProblem, localEnv, setLocalEnv } from './local-env.js';

describe('本机环境变量', () => {
  it('names: a shell variable name, and never one that routes the model / account / engine', () => {
    expect(envNameProblem('DATABASE_URL')).toBeNull();
    expect(envNameProblem('_x1')).toBeNull();
    expect(envNameProblem('1ABC')).toBe('invalid');
    expect(envNameProblem('A-B')).toBe('invalid');
    expect(envNameProblem('')).toBe('invalid');
    for (const k of ['ANTHROPIC_BASE_URL', 'anthropic_api_key', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_WEB_DIST', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'CW_GATEWAY_KEY', 'CLAUDE_CONFIG_DIR']) {
      expect(envNameProblem(k)).toBe('reserved');
    }
  });
  it('only usable names get through, and callers get a copy', () => {
    setLocalEnv({ DATABASE_URL: 'pg://x', ANTHROPIC_BASE_URL: 'http://evil', 'bad name': 'x' });
    const a = localEnv();
    expect(a).toEqual({ DATABASE_URL: 'pg://x' });
    a.DATABASE_URL = 'changed';
    expect(localEnv().DATABASE_URL).toBe('pg://x');
    setLocalEnv({});
  });
});

describe('LocalEnvStore', () => {
  const fakeSecrets = {
    protect: async (p: string) => `enc:test:${Buffer.from(p).toString('base64')}`,
    reveal: async (v?: string) => (v?.startsWith('enc:test:') ? Buffer.from(v.slice(9), 'base64').toString() : v ?? ''),
  };
  it('stores encrypted in its own file, hands processes the plain value, removes with null, refuses reserved names', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-env-')), 'local-env.json');
    const st = new LocalEnvStore(file, fakeSecrets);
    await st.set('DATABASE_URL', 'pg://x');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).DATABASE_URL).toMatch(/^enc:test:/);
    expect(localEnv()).toEqual({ DATABASE_URL: 'pg://x' });
    expect(await st.reveal('DATABASE_URL')).toBe('pg://x');
    expect(st.names()).toEqual(['DATABASE_URL']);
    await expect(st.set('ANTHROPIC_BASE_URL', 'x')).rejects.toThrow('reserved');
    await st.set('DATABASE_URL', null);
    expect(localEnv()).toEqual({});
    expect(st.names()).toEqual([]);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});
