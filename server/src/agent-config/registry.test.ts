import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import * as jsonc from 'jsonc-parser';
import { AGENT_ADAPTERS, AGENT_IDS, adapterFor, detectAgents, tryAdapter } from './registry.js';

let home: string;

beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-agents-')); });
afterEach(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const readJson = (p: string) => jsonc.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''), [], { allowTrailingComma: true, disallowComments: false });

describe('agent registry', () => {
  it('lists the seven agents with their config paths and fields', () => {
    expect([...AGENT_IDS]).toEqual(['claude-code', 'codex', 'gemini-cli', 'opencode', 'cursor', 'trae', 'qoder']);
    expect(AGENT_ADAPTERS).toHaveLength(7);
    expect(adapterFor('claude-code').configPath(home)).toBe(path.join(home, '.claude', 'settings.json'));
    expect(adapterFor('codex').configPath(home)).toBe(path.join(home, '.codex', 'config.toml'));
    expect(adapterFor('gemini-cli').configPath(home)).toBe(path.join(home, '.gemini', 'settings.json'));
    expect(adapterFor('opencode').configPath(home)).toBe(path.join(home, '.config', 'opencode', 'opencode.json'));
    expect(adapterFor('cursor').configPath(home)).toBe(path.join(home, '.cursor', 'cli-config.json'));
    expect(adapterFor('trae').modelField).toBe('model.name');
    expect(adapterFor('qoder').name).toBe('Qoder');
    expect(adapterFor('codex').effortField).toBe('model_reasoning_effort');
    expect(tryAdapter('nope')).toBeNull();
    expect(() => adapterFor('nope')).toThrow(/不支持的 agent/);
  });

  it('detects only configs that exist', async () => {
    expect(await adapterFor('cursor').detect(home)).toBe(false);
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    expect(await adapterFor('cursor').detect(home)).toBe(false); // the editor writes this folder too
    fs.writeFileSync(path.join(home, '.cursor', 'cli-config.json'), '{}\n');
    expect(await adapterFor('cursor').detect(home)).toBe(true);
    const all = await detectAgents(home);
    expect(all.find((a) => a.id === 'cursor')?.detected).toBe(true);
    expect(all.find((a) => a.id === 'codex')?.detected).toBe(false);
  });

  it('claude-code: reads / writes model + effort and restores the previous keys', async () => {
    const a = adapterFor('claude-code');
    const file = a.configPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ theme: 'dark', model: 'claude-sonnet-4-6', effortLevel: 'low', env: { KEEP: 'yes' }, permissions: { allow: ['Read'] } }, null, 2) + '\n');

    expect(await a.readModel(home)).toEqual({ model: 'claude-sonnet-4-6', effort: 'low' });
    const point = await a.writeModel(home, 'claude-opus-4-7', 'high');
    expect(await a.readModel(home)).toEqual({ model: 'claude-opus-4-7', effort: 'high' });
    const after = readJson(file);
    expect(after.theme).toBe('dark');
    expect(after.effortLevel).toBe('high');
    expect(after.env).toEqual({ KEEP: 'yes' });
    expect(after.permissions).toEqual({ allow: ['Read'] });

    await a.restore(home, point);
    expect(await a.readModel(home)).toEqual({ model: 'claude-sonnet-4-6', effort: 'low' });
    expect(readJson(file).effortLevel).toBe('low');
  });

  it('codex: TOML model + effort, comments and other tables kept; restore removes effort it added', async () => {
    const a = adapterFor('codex');
    const file = a.configPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const src = '# mine\nmodel = "gpt-5" # pinned\napproval_policy = "never"\n\n[mcp_servers.x]\ncommand = "y"\n';
    fs.writeFileSync(file, src);

    const point = await a.writeModel(home, 'gpt-5.5', 'xhigh');
    expect(await a.readModel(home)).toEqual({ model: 'gpt-5.5', effort: 'xhigh' });
    const doc: any = parseToml(fs.readFileSync(file, 'utf8'));
    expect(doc.model).toBe('gpt-5.5');
    expect(doc.mcp_servers.x.command).toBe('y');
    expect(fs.readFileSync(file, 'utf8')).toContain('# mine');

    await a.restore(home, point);
    const back: any = parseToml(fs.readFileSync(file, 'utf8'));
    expect(back.model).toBe('gpt-5');
    expect(back.model_reasoning_effort).toBeUndefined();
    expect(back.approval_policy).toBe('never');
  });

  it('gemini-cli: nested model.name, other model keys kept; no invented effort key', async () => {
    const a = adapterFor('gemini-cli');
    const file = a.configPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{\n  // chosen by hand\n  "theme": "Dracula",\n  "model": { "name": "gemini-2.5-pro", "maxSessionTurns": 5 }\n}\n');

    const point = await a.writeModel(home, 'gemini-3-pro');
    expect(await a.readModel(home)).toEqual({ model: 'gemini-3-pro', effort: '' });
    const doc = readJson(file);
    expect(doc.model).toEqual({ name: 'gemini-3-pro', maxSessionTurns: 5 });
    expect(fs.readFileSync(file, 'utf8')).toContain('// chosen by hand');
    await expect(a.writeModel(home, 'gemini-3-pro', 'HIGH')).rejects.toThrow(/没有可设置的推理强度/);

    await a.restore(home, point);
    expect(readJson(file).model).toEqual({ name: 'gemini-2.5-pro', maxSessionTurns: 5 });
  });

  it('opencode keeps JSONC comments; it has no separate effort setting', async () => {
    const a = adapterFor('opencode');
    const defaultFile = a.configPath(home);
    fs.mkdirSync(path.dirname(defaultFile), { recursive: true });
    const file = path.join(path.dirname(defaultFile), 'opencode.jsonc');
    fs.writeFileSync(file, '{\n  // theme stays\n  "theme": "tokyonight",\n  "model": "old/model"\n}\n');
    expect(a.configPath(home)).toBe(file); // an existing jsonc wins over the default json
    const point = await a.writeModel(home, 'group/coder');
    expect(fs.readFileSync(file, 'utf8')).toContain('// theme stays');
    expect(readJson(file)).toEqual({ theme: 'tokyonight', model: 'group/coder' });
    await expect(a.writeModel(home, 'm', 'high')).rejects.toThrow(/没有可设置的推理强度/);
    await a.restore(home, point);
    expect(readJson(file).model).toBe('old/model');
  });

  it('cursor / trae / qoder: creating, reading and restoring a CLI config', async () => {
    for (const id of ['cursor', 'trae', 'qoder'] as const) {
      const a = adapterFor(id);
      const file = a.configPath(home);
      fs.rmSync(file, { force: true });
      expect(await a.detect(home)).toBe(false);
      const point = await a.writeModel(home, 'gpt-5.5');
      expect(point.existed).toBe(false);
      expect(await a.detect(home)).toBe(true);
      expect(await a.readModel(home)).toEqual({ model: 'gpt-5.5', effort: '' });
      await a.restore(home, point);
      expect(fs.existsSync(file)).toBe(false);
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
      expect(await a.detect(home)).toBe(false);
    }
  });

  it('trae: trae_cli.yaml with model.name, comments kept', async () => {
    const a = adapterFor('trae');
    const file = a.configPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '# my Trae\npermission_mode: ask\nmodel:\n  name: old/model # pinned\n');
    const point = await a.writeModel(home, 'trae/new-model');
    expect(await a.readModel(home)).toEqual({ model: 'trae/new-model', effort: '' });
    expect(fs.readFileSync(file, 'utf8')).toContain('# my Trae');
    await a.restore(home, point);
    expect(await a.readModel(home)).toEqual({ model: 'old/model', effort: '' });
  });

  it('qoder: settings.json model.name + model.reasoningEffort', async () => {
    const a = adapterFor('qoder');
    const file = a.configPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ model: { name: 'old', reasoningEffort: 'low' }, enabledPlugins: ['x'] }, null, 2));
    const point = await a.writeModel(home, 'new-model', 'high');
    expect(await a.readModel(home)).toEqual({ model: 'new-model', effort: 'high' });
    expect(readJson(file).enabledPlugins).toEqual(['x']);
    await a.restore(home, point);
    expect(await a.readModel(home)).toEqual({ model: 'old', effort: 'low' });
  });

  it('restore refuses a point from another agent or another path', async () => {
    const codex = adapterFor('codex');
    const point = await codex.writeModel(home, 'gpt-5');
    await expect(adapterFor('gemini-cli').restore(home, point)).rejects.toThrow(/不属于/);
    await expect(codex.restore(home, { ...point, path: path.join(home, 'elsewhere.toml') })).rejects.toThrow(/不一致/);
  });
});
