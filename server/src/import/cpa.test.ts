import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpaAuthDir, parseCpa, parseCpaConfig, readCpa, redactCpa } from './cpa.js';

let dir: string, home: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-cpa-'));
  home = path.join(dir, 'home');
  fs.mkdirSync(home);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const CONFIG = `# v8 layout
config-version: 8
server:
  port: 8317
oauth:
  auth-dir: "~/.cli-proxy-api"
access:
  api-keys:
    - "sk-client-fake-1"
    - "sk-client-fake-2"
api-keys:
  claude:
    - name: relay
      base-url: "https://relay.example"
      models: [claude-opus-4-7]
      excluded-models: [claude-old]
      keys:
        - api-key: "sk-ant-fake-1"
        - api-key: "sk-ant-fake-2"
          weight: 2
  gemini:
    - base-url: "https://generativelanguage.googleapis.com"
      keys:
        - api-key: "fake-gemini-key"
  vertex:
    - name: vertex
      base-url: "https://us-central1-aiplatform.googleapis.com"
      models: [gemini-2.5-pro]
`;

function writeAuths() {
  const authDir = path.join(home, '.cli-proxy-api');
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(authDir, 'codex-ada@example.com.json'), JSON.stringify({ type: 'codex', email: 'ada@example.com', access_token: 'fake-access', refresh_token: 'fake-refresh', account_id: 'acct-1', expired: '2027-01-01T00:00:00Z' }));
  fs.writeFileSync(path.join(authDir, 'gemini.json'), JSON.stringify({ type: 'gemini', email: 'g@example.com', api_key: 'fake-api-key' }));
  fs.writeFileSync(path.join(authDir, 'broken.json'), '{ "type": "claude", "access_token": "fake-leak-secret",');
  fs.writeFileSync(path.join(authDir, 'notes.txt'), 'not an auth file');
  return authDir;
}

describe('CPA import', () => {
  it('parses the v8 config: port, api-key count, provider groups and models', () => {
    const c = parseCpaConfig(CONFIG);
    expect(c.port).toBe(8317);
    expect(c.authDir).toBe('~/.cli-proxy-api');
    expect(c.clientKeyCount).toBe(2);
    expect(c.providers.map((p) => p.name)).toEqual(['relay', 'Gemini #1', 'vertex']);
    const claude = c.providers[0];
    expect(claude).toMatchObject({ protocol: 'anthropic', baseUrl: 'https://relay.example', keyCount: 2, models: ['claude-opus-4-7'], excludedModels: ['claude-old'] });
    expect(claude.apiKeys).toEqual(['sk-ant-fake-1', 'sk-ant-fake-2']);
    expect(c.providers[1]).toMatchObject({ protocol: 'gemini', keyCount: 1 });
    expect(c.providers[2]).toMatchObject({ protocol: 'vertex', models: ['gemini-2.5-pro'] });
  });

  it('reads config.yaml + auths/*.json; bad files are skipped without quoting their contents', async () => {
    fs.writeFileSync(path.join(dir, 'config.yaml'), CONFIG);
    writeAuths();
    const c = await readCpa(dir, { home });
    expect(c.authDir).toBe(path.join(home, '.cli-proxy-api'));
    expect(c.auths.map((a) => a.file)).toEqual(['codex-ada@example.com.json', 'gemini.json']);
    const codex = c.auths[0];
    expect(codex).toMatchObject({ kind: 'codex', email: 'ada@example.com', accountId: 'acct-1', expired: '2027-01-01T00:00:00Z', hasAccessToken: true, hasRefreshToken: true, hasApiKey: false });
    expect(c.auths[1]).toMatchObject({ kind: 'gemini', email: 'g@example.com', hasApiKey: true, hasAccessToken: false });
    expect(c.warnings).toHaveLength(1);
    expect(c.warnings[0]).toContain('broken.json');
    expect(c.warnings[0]).not.toContain('fake-leak-secret');
  });

  it('redactCpa drops every key and token but keeps the counts', async () => {
    fs.writeFileSync(path.join(dir, 'config.yaml'), CONFIG);
    writeAuths();
    const c = await readCpa(dir, { home });
    const safe = JSON.stringify(redactCpa(c));
    for (const secret of ['sk-client-fake-1', 'sk-ant-fake-1', 'sk-ant-fake-2', 'fake-gemini-key', 'fake-access', 'fake-refresh', 'fake-api-key', 'fake-leak-secret']) {
      expect(safe).not.toContain(secret);
    }
    expect(redactCpa(c).providers[0].keyCount).toBe(2);
  });

  it('parses the legacy layout (top-level auth-dir, api-keys, <kind>-api-key)', () => {
    const legacy = `port: 8318
auth-dir: "./auths"
api-keys:
  - "legacy-client-key"
codex-api-key:
  - api-key: "fake-codex-key"
    base-url: "https://codex.example/v1"
    models:
      - gpt-5.5
`;
    const c = parseCpaConfig(legacy);
    expect(c.port).toBe(8318);
    expect(c.authDir).toBe('./auths');
    expect(c.clientKeyCount).toBe(1);
    expect(c.providers).toHaveLength(1);
    expect(c.providers[0]).toMatchObject({ protocol: 'openai', baseUrl: 'https://codex.example/v1', models: ['gpt-5.5'], keyCount: 1 });
    expect(cpaAuthDir(c, path.join(dir, 'config.yaml'), home)).toBe(path.join(dir, 'auths'));
  });

  it('a malformed config is rejected without quoting a secret-looking line', () => {
    const bad = `server:\n  port: 8317\nmanagement:\n  secret-key: super-secret-should-not-leak\n  bad: [unclosed\n`;
    let message = '';
    try { parseCpaConfig(bad); } catch (e: any) { message = e.message; }
    expect(message).toMatch(/config\.yaml/);
    expect(message).not.toContain('super-secret-should-not-leak');
  });

  it('parseCpa combines config text and already-read auth files', () => {
    const c = parseCpa(CONFIG, [{ file: 'codex-x.json', text: JSON.stringify({ type: 'codex', access_token: 'fake-a', refresh_token: 'fake-r' }) }]);
    expect(c.auths).toHaveLength(1);
    expect(c.auths[0]).toMatchObject({ kind: 'codex', hasAccessToken: true, hasRefreshToken: true });
  });

  it('missing config.yaml names the file', async () => {
    await expect(readCpa(path.join(dir, 'nope'), { home })).rejects.toThrow(/config\.yaml/);
  });
});
