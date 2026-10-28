// P8 接入: where each agent keeps the model it runs, how to detect it, and how to point it at another model
// (and, where the agent has one, a reasoning strength) without touching anything else in its config.
//
// This is deliberately separate from ./adapter.ts: the config center there manages MCP servers and a handful of
// CLI settings. This registry is the *selection* seam used by the 接入 page and by saved 方案 — model in, model out,
// plus a restore point that `restore()` puts back. Only the model / effort keys are written. JSON / TOML go through
// edit.ts's targeted rewrite (other bytes, comments and line endings stay as they were); YAML uses yaml's document
// API, which keeps comments while re-stringifying the file.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { atomicWrite } from './backup.js';
import { parseConfig, setJsonPath, setTomlTopLevel } from './edit.js';
import { tr } from '../i18n/index.js';

export type AgentId = 'claude-code' | 'codex' | 'gemini-cli' | 'opencode' | 'cursor' | 'trae' | 'qoder';

export interface AgentModelState {
  /** the model the config names; '' when the file / key is absent */
  model: string;
  /** the reasoning strength the config names; '' when unsupported or absent */
  effort: string;
}

/** What `writeModel` changed, enough for `restore` to put the previous values back. */
export interface AgentRestorePoint {
  agent: AgentId;
  /** the config file that was written (checked again on restore) */
  path: string;
  /** false = we created the file; restore removes it again when nothing else is left */
  existed: boolean;
  /** previous values; null = the key was not set */
  model: string | null;
  effort: string | null;
  /** false = effort was left alone by writeModel, so restore leaves it alone too */
  effortTouched: boolean;
}

export interface AgentAdapter {
  readonly id: AgentId;
  readonly name: string;
  /** dotted key inside the config file (`model`, `model.name`, `model.modelId`) */
  readonly modelField: string;
  /** dotted key for reasoning strength; null = this agent has no environment-independent setting for it */
  readonly effortField: string | null;
  /** absolute path of the config file for a given home directory */
  configPath(home: string): string;
  /** true when the agent's config file or its own directory exists (a local install / login is present) */
  detect(home: string): Promise<boolean>;
  /** current model / effort as written in the config (missing file reads as {{ model: '', effort: '' }}) */
  readModel(home: string): Promise<AgentModelState>;
  /** set the model (and optionally effort: undefined = leave, null = remove) and return the previous values */
  writeModel(home: string, model: string, effort?: string | null): Promise<AgentRestorePoint>;
  /** put back exactly what `writeModel` replaced */
  restore(home: string, point: AgentRestorePoint): Promise<void>;
}

type Format = 'json' | 'toml' | 'yaml';

interface Def {
  id: AgentId;
  name: string;
  /** directory under home that also counts as detected (the config's parent) */
  dir: string[];
  /** default config file, and other names the agent accepts (the first existing one wins) */
  file: string;
  alternates?: string[];
  format: Format;
  modelField: string;
  effortField: string | null;
  /** true = only the config file counts (the editor also writes the folder, e.g. ~/.cursor) */
  fileOnly?: boolean;
}

// Paths and keys are the ones each agent documents for its user-level config:
//   Claude Code ~/.claude/settings.json (magpie reads effortLevel; newer builds also modelSettings.<model>)
//   Codex ~/.codex/config.toml, Gemini CLI ~/.gemini/settings.json (model.name; no portable effort key)
//   OpenCode ~/.config/opencode/opencode.json(c), Cursor CLI ~/.cursor/cli-config.json (model.modelId)
//   TraeCode CLI ~/.trae/trae_cli.yaml (model.name), Qoder ~/.qoder/settings.json (model.name / model.reasoningEffort)
// Where a vendor has no separate reasoning setting, effortField stays null rather than inventing a key.
const DEFS: Def[] = [
  { id: 'claude-code', name: 'Claude Code', dir: ['.claude'], file: 'settings.json', format: 'json', modelField: 'model', effortField: 'effortLevel' },
  { id: 'codex', name: 'Codex', dir: ['.codex'], file: 'config.toml', format: 'toml', modelField: 'model', effortField: 'model_reasoning_effort' },
  { id: 'gemini-cli', name: 'Gemini CLI', dir: ['.gemini'], file: 'settings.json', format: 'json', modelField: 'model.name', effortField: null },
  { id: 'opencode', name: 'OpenCode', dir: ['.config', 'opencode'], file: 'opencode.json', alternates: ['opencode.jsonc', 'config.json'], format: 'json', modelField: 'model', effortField: null },
  { id: 'cursor', name: 'Cursor', dir: ['.cursor'], file: 'cli-config.json', format: 'json', modelField: 'model.modelId', effortField: null, fileOnly: true },
  { id: 'trae', name: 'Trae', dir: ['.trae'], file: 'trae_cli.yaml', alternates: ['traecli.yaml'], format: 'yaml', modelField: 'model.name', effortField: null, fileOnly: true },
  { id: 'qoder', name: 'Qoder', dir: ['.qoder'], file: 'settings.json', format: 'json', modelField: 'model.name', effortField: 'model.reasoningEffort', fileOnly: true },
];

function homeDir(home: string): string {
  return home && home.trim() ? home : os.homedir();
}

function dotGet(doc: unknown, dotted: string): string {
  let node: any = doc;
  for (const key of dotted.split('.')) node = node && typeof node === 'object' ? node[key] : undefined;
  if (node === undefined || node === null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  return '';
}

function checkValue(value: string, what: string): string {
  const v = value.trim();
  if (!v) throw new Error(tr('{what}不能为空', { what }));
  if (/[\r\n]/.test(v)) throw new Error(tr('值不能包含换行'));
  return v;
}

/** An object / array whose every leaf is empty — what a targeted delete can leave behind (`{ model: {} }`). */
function emptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.every(emptyValue);
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every(emptyValue);
  return false;
}

function normPath(p: string): string {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

class FileAdapter implements AgentAdapter {
  readonly id: AgentId;
  readonly name: string;
  readonly modelField: string;
  readonly effortField: string | null;

  constructor(private readonly def: Def) {
    this.id = def.id;
    this.name = def.name;
    this.modelField = def.modelField;
    this.effortField = def.effortField;
  }

  private dir(home: string): string {
    return path.join(homeDir(home), ...this.def.dir);
  }

  configPath(home: string): string {
    const dir = this.dir(home);
    for (const name of [this.def.file, ...(this.def.alternates ?? [])]) {
      const p = path.join(dir, name);
      if (existsSync(p)) return p;
    }
    return path.join(dir, this.def.file);
  }

  async detect(home: string): Promise<boolean> {
    const paths = this.def.fileOnly ? [this.configPath(home)] : [this.configPath(home), this.dir(home)];
    for (const p of paths) {
      try { await fs.stat(p); return true; } catch { /* try the next one */ }
    }
    return false;
  }

  private async text(home: string): Promise<string> {
    try { return await fs.readFile(this.configPath(home), 'utf8'); } catch (e: any) {
      if (e?.code === 'ENOENT') return '';
      throw e;
    }
  }

  private async existed(home: string): Promise<boolean> {
    try { await fs.stat(this.configPath(home)); return true; } catch { return false; }
  }

  private doc(text: string): Record<string, unknown> {
    if (this.def.format !== 'yaml') return parseConfig(text, this.def.format);
    const doc = parseDocument(text.replace(/^\uFEFF/, ''));
    if (doc.errors.length) throw new Error(tr('{agent} 的配置不是有效的 YAML', { agent: this.name }));
    const js = doc.toJS();
    return js && typeof js === 'object' && !Array.isArray(js) ? (js as Record<string, unknown>) : {};
  }

  private values(text: string): AgentModelState {
    const doc = this.doc(text);
    return { model: dotGet(doc, this.modelField), effort: this.effortField ? dotGet(doc, this.effortField) : '' };
  }

  async readModel(home: string): Promise<AgentModelState> {
    return this.values(await this.text(home));
  }

  /** Apply the named keys in order; `null` removes a key. */
  private apply(text: string, edits: { field: string; value: string | null }[]): string {
    let out = text;
    if (this.def.format === 'yaml') {
      const bom = out.startsWith('\uFEFF') ? '\uFEFF' : '';
      const doc = parseDocument(out.slice(bom.length));
      for (const edit of edits) {
        const route = edit.field.split('.');
        if (edit.value === null) doc.deleteIn(route);
        else doc.setIn(route, edit.value);
      }
      if (doc.errors.length) throw new Error(tr('{agent} 的配置不是有效的 YAML', { agent: this.name }));
      return bom + String(doc);
    }
    for (const edit of edits) {
      if (this.def.format === 'json') {
        out = setJsonPath(out.trim() ? out : '{}\n', edit.field.split('.'), edit.value === null ? undefined : edit.value);
      } else {
        if (edit.field.includes('.')) throw new Error(tr('{agent} 的 {field} 不是顶层键，无法写入', { agent: this.name, field: edit.field }));
        out = setTomlTopLevel(out, edit.field, edit.value === null ? undefined : edit.value);
      }
    }
    return out;
  }

  async writeModel(home: string, model: string, effort?: string | null): Promise<AgentRestorePoint> {
    const nextModel = checkValue(model, tr('模型'));
    if (effort !== undefined && effort !== null && this.effortField === null) {
      throw new Error(tr('{agent} 没有可设置的推理强度', { agent: this.name }));
    }
    const nextEffort = effort === undefined ? undefined : effort === null ? null : checkValue(effort, tr('推理强度'));
    const file = this.configPath(home);
    const [original, existed] = await Promise.all([this.text(home), this.existed(home)]);
    const before = this.values(original);
    const edits: { field: string; value: string | null }[] = [{ field: this.modelField, value: nextModel }];
    if (nextEffort !== undefined) edits.push({ field: this.effortField!, value: nextEffort });
    const next = this.apply(original, edits);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, next);
    return {
      agent: this.id,
      path: file,
      existed,
      model: before.model || null,
      effort: before.effort || null,
      effortTouched: nextEffort !== undefined,
    };
  }

  async restore(home: string, point: AgentRestorePoint): Promise<void> {
    if (!point || point.agent !== this.id) throw new Error(tr('这份还原记录不属于 {agent}', { agent: this.name }));
    const file = this.configPath(home);
    if (normPath(point.path) !== normPath(file)) throw new Error(tr('还原记录里的路径和 {agent} 的配置文件不一致', { agent: this.name }));
    if (point.effortTouched && this.effortField === null) throw new Error(tr('{agent} 没有可恢复的推理强度设置', { agent: this.name }));
    const original = await this.text(home);
    const edits: { field: string; value: string | null }[] = [{ field: this.modelField, value: point.model }];
    if (point.effortTouched) edits.push({ field: this.effortField!, value: point.effort });
    const next = this.apply(original, edits);
    if (!point.existed) {
      let empty = false;
      try { empty = emptyValue(this.doc(next)); } catch { /* unparsable: keep it */ }
      if (empty) { await fs.rm(file, { force: true }); return; }
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, next);
  }
}

export const AGENT_ADAPTERS: readonly AgentAdapter[] = Object.freeze(DEFS.map((d) => new FileAdapter(d)));
/** Short aliases used by the 接入 page / tests. */
export const ADAPTERS = AGENT_ADAPTERS;
export const AGENTS = AGENT_ADAPTERS;
export const registry = AGENT_ADAPTERS;
export const AGENT_IDS: readonly AgentId[] = Object.freeze(AGENT_ADAPTERS.map((a) => a.id));

export function tryAdapter(id: string): AgentAdapter | null {
  return AGENT_ADAPTERS.find((a) => a.id === id) ?? null;
}

export function adapterFor(id: string): AgentAdapter {
  const a = tryAdapter(id);
  if (!a) throw new Error(tr('不支持的 agent：{kind}', { kind: id }));
  return a;
}

/** For the 接入 page's first paint: every known agent and whether its config is on this machine. */
export async function detectAgents(home: string): Promise<{ id: AgentId; name: string; configPath: string; detected: boolean }[]> {
  return Promise.all(AGENT_ADAPTERS.map(async (a) => ({ id: a.id, name: a.name, configPath: a.configPath(home), detected: await a.detect(home) })));
}

export default AGENT_ADAPTERS;
