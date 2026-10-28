import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHATGPT_CODEX_BASE, CODE_ASSIST_BASE, codexLogin, geminiLogin, OPENAI_V1, ownLoginCoverage, ownLoginLaunch } from './agents.js';

const tmp: string[] = [];
afterEach(() => { for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const home = (files: Record<string, string>) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-privagent-'));
  tmp.push(d);
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); }
  return d;
};
const route = (t: string) => `http://127.0.0.1:3090/gateway/~v/sig/${Buffer.from(t).toString('base64url')}`;
const off = () => null;

describe('agents on their own login go through the privacy relay', () => {
  it('Codex with a ChatGPT login: the ChatGPT backend through the relay (env + config key)', () => {
    const h = home({ '.codex/auth.json': JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'x' } }) });
    expect(codexLogin({}, h).mode).toBe('chatgpt');
    const l = ownLoginLaunch('codex', route, {}, h);
    expect(l.env.OPENAI_BASE_URL).toBe(route(CHATGPT_CODEX_BASE));
    expect(l.args).toEqual(['-c', `openai_base_url=${JSON.stringify(route(CHATGPT_CODEX_BASE))}`]);
  });

  it('Codex with an API key: api.openai.com; a base the user set wins', () => {
    const h = home({ '.codex/auth.json': JSON.stringify({ OPENAI_API_KEY: 'sk-x' }) });
    expect(ownLoginLaunch('codex', route, {}, h).env.OPENAI_BASE_URL).toBe(route(OPENAI_V1));
    expect(ownLoginLaunch('codex', route, { OPENAI_BASE_URL: 'https://my.proxy/v1' }, h).env.OPENAI_BASE_URL).toBe(route('https://my.proxy/v1'));
  });

  it('Codex on another provider in config.toml is left alone and listed as not covered', () => {
    const h = home({ '.codex/auth.json': '{}', '.codex/config.toml': 'model_provider = "azure"\n[model_providers.azure]\nname="x"\n' });
    expect(ownLoginLaunch('codex', route, {}, h)).toEqual({ env: {}, args: [] });
    expect(ownLoginCoverage({}, h).find((c) => c.agent === 'codex')?.covered).toBe(false);
    // a model_provider inside a table is not the one in use
    const h2 = home({ '.codex/config.toml': '[profiles.x]\nmodel_provider = "azure"\n' });
    expect(codexLogin({}, h2).provider).toBeUndefined();
  });

  it('Gemini CLI with a Google login: Code Assist through the relay (and the other two bases)', () => {
    const h = home({ '.gemini/settings.json': JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } }) });
    expect(geminiLogin({}, h)).toBe('oauth-personal');
    const l = ownLoginLaunch('gemini', route, {}, h);
    expect(l.env.CODE_ASSIST_ENDPOINT).toBe(route(CODE_ASSIST_BASE));
    expect(l.env.GOOGLE_GEMINI_BASE_URL).toBeTruthy();
    expect(l.env.GOOGLE_VERTEX_BASE_URL).toBe(route('https://us-central1-aiplatform.googleapis.com'));
    expect(ownLoginCoverage({}, h).find((c) => c.agent === 'gemini')).toMatchObject({ covered: true });
  });

  it('nothing changes while privacy is neither on nor armed; other agents get nothing and are not covered', () => {
    const h = home({});
    expect(ownLoginLaunch('codex', off, {}, h)).toEqual({ env: {}, args: [] });
    expect(ownLoginLaunch('gemini', off, {}, h)).toEqual({ env: {}, args: [] });
    expect(ownLoginLaunch('qwen', route, {}, h)).toEqual({ env: {}, args: [] });
    const cov = ownLoginCoverage({}, h);
    expect(cov.find((c) => c.agent === 'qwen')?.covered).toBe(false);
    expect(cov.find((c) => c.agent === 'codex')?.covered).toBe(true);
  });
});
