import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentSelectionService } from './selections.js';
import { handleAgentConfig } from './handlers.js';
import { AgentConfigService } from './service.js';

let home: string;
let data: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sel-home-'));
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sel-data-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const svc = (wsl: { distro: string; home: string }[] = []) => new AgentSelectionService({ file: path.join(data, 'agent-selections.json'), home: () => home, wslHomes: () => wsl });
const codexFile = () => path.join(home, '.codex', 'config.toml');
const writeCodex = (text: string) => { fs.mkdirSync(path.dirname(codexFile()), { recursive: true }); fs.writeFileSync(codexFile(), text); };

describe('agent selections (接入)', () => {
  it('lists every registry agent with its config and no drift when claude-web never wrote it', async () => {
    writeCodex('model = "gpt-5"\nmodel_reasoning_effort = "low"\n');
    const list = await svc().list();
    expect(list.map((a) => a.id)).toEqual(['claude-code', 'codex', 'gemini-cli', 'opencode', 'cursor', 'trae', 'qoder']);
    const codex = list.find((a) => a.id === 'codex')!;
    expect(codex).toMatchObject({ detected: true, model: 'gpt-5', effort: 'low', effortField: true, drift: null, restorable: false });
    expect(codex.expected).toBeUndefined();
    expect(list.find((a) => a.id === 'cursor')).toMatchObject({ detected: false, model: '', drift: null });
  });

  it('apply → no drift; an outside edit → drift; re-apply puts our value back', async () => {
    writeCodex('# mine\nmodel = "gpt-5"\n');
    const s = svc();
    const applied = await s.apply('codex', 'gpt-5.5', 'high');
    expect(applied).toMatchObject({ model: 'gpt-5.5', effort: 'high', expected: { model: 'gpt-5.5', effort: 'high' }, drift: { drifted: false }, restorable: true });
    writeCodex(fs.readFileSync(codexFile(), 'utf8').replace('gpt-5.5', 'o3'));
    const drifted = await svc().get('codex'); // a fresh service reads the record from disk
    expect(drifted.drift).toEqual({ drifted: true, changes: [{ field: 'model', current: 'o3', expected: 'gpt-5.5' }] });
    const back = await svc().reapply('codex');
    expect(back.drift?.drifted).toBe(false);
    expect(fs.readFileSync(codexFile(), 'utf8')).toContain('# mine');
    expect(fs.readFileSync(codexFile(), 'utf8')).toContain('model = "gpt-5.5"');
  });

  it('accept takes the edited file as the new expected value', async () => {
    writeCodex('model = "gpt-5"\n');
    const s = svc();
    await s.apply('codex', 'gpt-5.5');
    writeCodex('model = "o3"\n');
    const accepted = await s.accept('codex');
    expect(accepted.expected).toEqual({ model: 'o3' });
    expect(accepted.drift?.drifted).toBe(false);
  });

  it('restore puts back what was there before the first write (not the second) and forgets the record', async () => {
    writeCodex('model = "gpt-5"\nmodel_reasoning_effort = "low"\n');
    const s = svc();
    await s.apply('codex', 'gpt-5.5', 'high');
    await s.apply('codex', 'o3', 'medium');
    const r = await s.restore('codex');
    expect(r).toMatchObject({ model: 'gpt-5', effort: 'low', drift: null, restorable: false });
    expect(r.expected).toBeUndefined();
    await expect(s.restore('codex')).rejects.toThrow(/没有可还原/);
  });

  it('reapply / accept without a record, and unknown agents, are refused', async () => {
    await expect(svc().reapply('codex')).rejects.toThrow();
    await expect(svc().accept('gemini-cli')).rejects.toThrow();
    await expect(svc().apply('nope', 'x')).rejects.toThrow(/不支持的 agent/);
  });

  it('reports a WSL twin of the same agent, with its own drift', async () => {
    const wslHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sel-wsl-'));
    try {
      fs.mkdirSync(path.join(wslHome, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(wslHome, '.codex', 'config.toml'), 'model = "gpt-4.1"\n');
      writeCodex('model = "gpt-5"\n');
      const s = svc([{ distro: 'Ubuntu', home: wslHome }]);
      await s.apply('codex', 'gpt-5.5');
      const codex = await s.get('codex');
      expect(codex.wsl).toEqual([{ distro: 'Ubuntu', configPath: path.join(wslHome, '.codex', 'config.toml'), model: 'gpt-4.1', effort: '', drift: { drifted: true, changes: [{ field: 'model', current: 'gpt-4.1', expected: 'gpt-5.5' }] } }]);
      expect((await s.get('claude-code')).wsl).toBeUndefined();
    } finally { fs.rmSync(wslHome, { recursive: true, force: true }); }
  });

  it('is reachable through the agentConfig.* handlers of the service', async () => {
    writeCodex('model = "gpt-5"\n');
    const service = new AgentConfigService({ agents: { list: async () => [], launch: () => ({ command: 'x', env: {} }) } as any, backupDir: path.join(data, 'config-backups'), home: () => home });
    const list = await handleAgentConfig(service, { kind: 'agentConfig.selections' }) as any[];
    expect(list.find((a) => a.id === 'codex').model).toBe('gpt-5');
    await handleAgentConfig(service, { kind: 'agentConfig.selection.apply', agent: 'codex', model: 'gpt-5.5' });
    expect(fs.existsSync(path.join(data, 'agent-selections.json'))).toBe(true);
    writeCodex('model = "o3"\n');
    expect(((await handleAgentConfig(service, { kind: 'agentConfig.selection.reapply', agent: 'codex' })) as any).model).toBe('gpt-5.5');
    expect(((await handleAgentConfig(service, { kind: 'agentConfig.selection.restore', agent: 'codex' })) as any).model).toBe('gpt-5');
  });
});
