import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseMagpieProviders, preferredEndpoint, readMagpieProviders, redactMagpie } from './magpie.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-magpie-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const FILE = {
  providers: [
    {
      id: 'openrouter', name: 'OpenRouter', preset: 'openrouter',
      key: 'sk-or-fake-main',
      keys: [{ name: 'second', key: 'sk-or-fake-second' }, { name: 'off', key: 'sk-or-fake-off', off: true }],
      chat: 'https://openrouter.ai/api/v1', responses: 'https://openrouter.ai/api/v1',
      models: ['anthropic/claude-opus-4-7', 'openai/gpt-5.5'],
    },
    {
      id: 'anthropic-relay', name: 'Anthropic relay', off: true,
      key: 'sk-ant-fake',
      anthropic: 'https://relay.example',
      models: [],
    },
    { id: '', name: 'no id but a name', key: 'sk-fake' },
    { nope: true },
    { id: 'empty', name: 'Empty' },
  ],
  groups: [{ id: 'g1' }, { id: 'g2' }],
};

describe('Magpie providers.json import', () => {
  it('parses providers, keys (enabled only), endpoints, models and group count', () => {
    const m = parseMagpieProviders(JSON.stringify(FILE));
    expect(m.groups).toBe(2);
    expect(m.skipped).toBe(1);
    expect(m.providers.map((p) => p.id)).toEqual(['openrouter', 'anthropic-relay', 'no id but a name', 'empty']);
    const or = m.providers[0];
    expect(or).toMatchObject({ name: 'OpenRouter', preset: 'openrouter', off: false, keyCount: 3, models: ['anthropic/claude-opus-4-7', 'openai/gpt-5.5'] });
    expect(or.apiKeys).toEqual(['sk-or-fake-main', 'sk-or-fake-second']);
    expect(or.endpoints).toEqual({ chat: 'https://openrouter.ai/api/v1', responses: 'https://openrouter.ai/api/v1', anthropic: '', gemini: '' });
    expect(preferredEndpoint(or)).toEqual({ protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1' });
    expect(preferredEndpoint(m.providers[1])).toEqual({ protocol: 'anthropic', baseUrl: 'https://relay.example' });
    // an id-less entry uses its name; an entry with neither is skipped
    expect(m.providers[2].id).toBe('no id but a name');
  });

  it('accepts a bare array and an id map', () => {
    expect(parseMagpieProviders(JSON.stringify([{ id: 'a', key: 'sk-fake' }])).providers[0].id).toBe('a');
    const map = parseMagpieProviders(JSON.stringify({ b: { name: 'B', key: 'sk-fake' } }));
    expect(map.providers[0]).toMatchObject({ id: 'b', name: 'B' });
    const single = parseMagpieProviders(JSON.stringify({ id: 'solo', name: 'Solo', key: 'sk-fake' }));
    expect(single.providers[0]).toMatchObject({ id: 'solo', name: 'Solo', apiKeys: ['sk-fake'] });
  });

  it('redaction removes keys and leaves counts', () => {
    const m = parseMagpieProviders(JSON.stringify(FILE));
    const safe = JSON.stringify(redactMagpie(m));
    expect(safe).not.toContain('sk-or-fake');
    expect(safe).not.toContain('sk-ant-fake');
    expect(redactMagpie(m).providers[0].keyCount).toBe(3);
    expect(redactMagpie(m).providers[0].apiKeys).toEqual([]);
  });

  it('reads a file or a directory; a malformed file is refused without echoing the key', async () => {
    fs.writeFileSync(path.join(dir, 'providers.json'), JSON.stringify(FILE));
    expect((await readMagpieProviders(path.join(dir, 'providers.json'))).providers).toHaveLength(4);
    expect((await readMagpieProviders(dir)).providers).toHaveLength(4);
    fs.writeFileSync(path.join(dir, 'bad.json'), '{ "providers": [ { "key": "sk-should-not-leak" ');
    let message = '';
    try { await readMagpieProviders(path.join(dir, 'bad.json')); } catch (e: any) { message = e.message; }
    expect(message).toContain('providers.json');
    expect(message).not.toContain('sk-should-not-leak');
  });

  it('a missing file is an error naming the file', async () => {
    await expect(readMagpieProviders(path.join(dir, 'nope'))).rejects.toThrow(/providers\.json/);
  });
});
