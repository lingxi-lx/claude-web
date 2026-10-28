// 接入: which model each local agent (registry.ts) is set to, what claude-web last wrote there, and whether the
// file was changed since by someone else (drift.ts). After Magpie internal/agent (applied.go: the applied record
// per agent and "follow drift"; wsl.go: the same agent inside a WSL distro). MIT.
//
// The record lives in <dataDir>/agent-selections.json: per agent the selection we wrote (`expected`) and the
// restore point of the first write (what `restore` puts back). Re-apply writes `expected` again; accept takes the
// file's current values as the new `expected`. Agents never written by us have no record and never drift.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite } from './backup.js';
import { compare, type ModelSelection } from './drift.js';
import { AGENT_ADAPTERS, adapterFor, type AgentAdapter, type AgentId, type AgentRestorePoint } from './registry.js';
import { wslService } from '../wsl/service.js';
import type { AgentSelectionState, AgentSelectionTwin } from './types.js';
import { tr } from '../i18n/index.js';

export type { AgentSelectionState, AgentSelectionTwin };

interface Record_ {
  expected: ModelSelection;
  at: number;
  point?: AgentRestorePoint;
}

interface FileShape { version: 1; agents: Partial<Record<AgentId, Record_>> }

export interface SelectionOptions {
  /** the JSON file the records live in */
  file: string;
  home?: () => string;
  /** WSL homes as Windows reads them (`\\wsl.localhost\<distro>\home\me`); default: the WSL service's checked distros */
  wslHomes?: () => { distro: string; home: string }[];
}

function defaultWslHomes(): { distro: string; home: string }[] {
  const w = wslService();
  if (!w?.available()) return [];
  const out: { distro: string; home: string }[] = [];
  for (const root of w.roots()) {
    const m = /^\\\\wsl\.localhost\\([^\\]+)$/.exec(root);
    if (!m) continue;
    const home = w.cached(m[1])?.home;
    if (home && home.startsWith('/')) out.push({ distro: m[1], home: `${root}${home.split('/').filter(Boolean).map((s) => `\\${s}`).join('')}` });
  }
  return out;
}

export class AgentSelectionService {
  private data: FileShape | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private opts: SelectionOptions) {}

  private home() { return this.opts.home?.() ?? os.homedir(); }

  private async load(): Promise<FileShape> {
    if (this.data) return this.data;
    try {
      const j = JSON.parse(await fs.readFile(this.opts.file, 'utf8'));
      this.data = j && j.version === 1 && j.agents && typeof j.agents === 'object' ? j : { version: 1, agents: {} };
    } catch { this.data = { version: 1, agents: {} }; }
    return this.data!;
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.opts.file), { recursive: true });
    await atomicWrite(this.opts.file, JSON.stringify(this.data, null, 1) + '\n', { mode: 0o600 });
  }

  /** One write at a time (the record file and the agents' files). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  private async state(a: AgentAdapter, rec: Record_ | undefined): Promise<AgentSelectionState> {
    const home = this.home();
    const base = { id: a.id, name: a.name, configPath: a.configPath(home), effortField: a.effortField !== null, restorable: !!rec?.point };
    const detected = await a.detect(home);
    let current = { model: '', effort: '' };
    let error: string | undefined;
    try { current = await a.readModel(home); } catch (e: any) { error = String(e?.message ?? e); }
    const expected = rec?.expected;
    const twins: AgentSelectionTwin[] = [];
    for (const w of this.opts.wslHomes?.() ?? defaultWslHomes()) {
      try {
        if (!(await a.detect(w.home))) continue;
        const cur = await a.readModel(w.home);
        twins.push({ distro: w.distro, configPath: a.configPath(w.home), ...cur, drift: expected ? compare(cur, expected) : null });
      } catch { /* unreadable twin: skip */ }
    }
    return {
      ...base,
      detected,
      ...current,
      ...(expected ? { expected, appliedAt: rec!.at } : {}),
      drift: expected && !error ? compare(current, expected) : null,
      ...(error ? { error } : {}),
      ...(twins.length ? { wsl: twins } : {}),
    };
  }

  async list(): Promise<AgentSelectionState[]> {
    const data = await this.load();
    return Promise.all(AGENT_ADAPTERS.map((a) => this.state(a, data.agents[a.id])));
  }

  async get(agent: string): Promise<AgentSelectionState> {
    const a = adapterFor(agent);
    return this.state(a, (await this.load()).agents[a.id]);
  }

  /** Write model (and effort: undefined = leave, null = remove) and remember it as what this agent should have. */
  apply(agent: string, model: string, effort?: string | null): Promise<AgentSelectionState> {
    return this.serial(async () => {
      const a = adapterFor(agent);
      const data = await this.load();
      const point = await a.writeModel(this.home(), model, effort);
      const prev = data.agents[a.id];
      const expected: ModelSelection = { model: model.trim() };
      if (effort !== undefined) expected.effort = effort === null ? null : effort.trim();
      else if (prev?.expected && 'effort' in prev.expected) expected.effort = prev.expected.effort;
      // keep the first restore point: "restore" means "as it was before claude-web touched it"
      data.agents[a.id] = { expected, at: Date.now(), point: prev?.point ?? point };
      await this.save();
      return this.state(a, data.agents[a.id]);
    });
  }

  /** Drifted: write what we wrote last time again. */
  reapply(agent: string): Promise<AgentSelectionState> {
    return this.serial(async () => {
      const a = adapterFor(agent);
      const data = await this.load();
      const rec = data.agents[a.id];
      if (!rec?.expected?.model) throw new Error(tr('{agent} 没有 claude-web 写过的模型，无法重新应用', { agent: a.name }));
      const effort = a.effortField === null ? undefined : 'effort' in rec.expected ? (rec.expected.effort || null) : undefined;
      await a.writeModel(this.home(), rec.expected.model, effort);
      rec.at = Date.now();
      await this.save();
      return this.state(a, rec);
    });
  }

  /** Drifted: keep the file as it is now and remember that as what this agent should have. */
  accept(agent: string): Promise<AgentSelectionState> {
    return this.serial(async () => {
      const a = adapterFor(agent);
      const data = await this.load();
      const rec = data.agents[a.id];
      if (!rec) throw new Error(tr('{agent} 没有 claude-web 写过的模型', { agent: a.name }));
      const cur = await a.readModel(this.home());
      const expected: ModelSelection = { model: cur.model };
      if ('effort' in rec.expected) expected.effort = cur.effort || null;
      rec.expected = expected;
      rec.at = Date.now();
      await this.save();
      return this.state(a, rec);
    });
  }

  /** Put back what the file had before claude-web first wrote it, and forget the record. */
  restore(agent: string): Promise<AgentSelectionState> {
    return this.serial(async () => {
      const a = adapterFor(agent);
      const data = await this.load();
      const rec = data.agents[a.id];
      if (!rec?.point) throw new Error(tr('{agent} 没有可还原的记录', { agent: a.name }));
      await a.restore(this.home(), rec.point);
      delete data.agents[a.id];
      await this.save();
      return this.state(a, undefined);
    });
  }
}
