import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BUILTIN, BUILTIN_IDS, parseAssignTarget, validateCharacter, withoutCharacter,
  type AssignTarget, type CafeAssign, type CharacterDef, type CharacterSaveResult, type CharactersList, type CharactersRequest,
} from './core/index.js';
import { tr } from '../i18n/index.js';

/**
 * 网吧's character library (spec §4): the built-ins plus `<dataDir>/characters/<id>.json` (drafts and saved ones), and
 * who gets which (meta.json `cafe.assign`). Every change emits `changed` (→ `characters.changed` to every window).
 */
export interface AssignStore { get(): CafeAssign | undefined; set(a: CafeAssign): Promise<void> | void }

export class CharacterService extends EventEmitter {
  private warned = new Set<string>();
  constructor(private dir: string, private assignStore: AssignStore) { super(); }

  async list(): Promise<CharacterDef[]> {
    let names: string[] = [];
    try { names = (await fs.readdir(this.dir)).filter((n) => n.endsWith('.json')); } catch { /* none yet */ }
    const out: CharacterDef[] = [...BUILTIN];
    for (const n of names.sort()) {
      const def = await this.readFile(n);
      if (def) out.push(def);
    }
    return out;
  }

  async get(id: string): Promise<CharacterDef | undefined> {
    return (await this.list()).find((c) => c.id === id);
  }

  async listWithAssign(): Promise<CharactersList> {
    return { characters: await this.list(), assign: this.assignStore.get() ?? {} };
  }

  private async readFile(n: string): Promise<CharacterDef | null> {
    try {
      const j = JSON.parse(await fs.readFile(path.join(this.dir, n), 'utf8'));
      const r = validateCharacter(j);
      if (r.ok && !BUILTIN_IDS.has(r.def.id) && `${r.def.id}.json` === n) return r.def;
      throw new Error(r.ok ? tr('id 和文件名不一致') : r.errors[0]);
    } catch (e: any) {
      if (!this.warned.has(n)) { this.warned.add(n); console.warn(`[characters] skipped ${n}: ${e?.message ?? e}`); }
      return null;
    }
  }

  /** Save a character (`draft`: shown in the library as 草稿). A built-in's id cannot be taken. */
  async save(x: unknown, draft: boolean): Promise<CharacterSaveResult> {
    const r = validateCharacter(x);
    if (!r.ok) return r;
    if (BUILTIN_IDS.has(r.def.id)) return { ok: false, errors: [tr('id {id} 是内置角色的，换一个', { id: r.def.id })] };
    const def: CharacterDef = { ...r.def };
    if (draft) def.draft = true; else delete def.draft;
    await this.write(def);
    return { ok: true, def };
  }

  /** A draft becomes a saved character. */
  async publish(id: string): Promise<CharacterSaveResult> {
    const c = await this.get(id);
    if (!c) return { ok: false, errors: [tr('没有 id 为 {id} 的角色', { id })] };
    if (c.builtin) return { ok: false, errors: [tr('{id} 是内置角色', { id })] };
    if (!c.draft) return { ok: true, def: c };
    const def = { ...c };
    delete def.draft;
    await this.write(def);
    return { ok: true, def };
  }

  private async write(def: CharacterDef) {
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${def.id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(def, null, 1));
    await fs.rename(tmp, file);
    this.warned.delete(`${def.id}.json`);
    this.emit('changed');
  }

  async remove(id: string): Promise<boolean> {
    if (BUILTIN_IDS.has(id) || !/^[a-z0-9-]{1,40}$/.test(id)) return false;
    try { await fs.rm(path.join(this.dir, `${id}.json`)); } catch { return false; }
    await this.assignStore.set(withoutCharacter(this.assignStore.get(), id));
    this.emit('changed');
    return true;
  }

  /** Give a character to someone (`id` null: take it back). The id must exist and not be a draft. */
  async assign(id: string | null, target: AssignTarget): Promise<CafeAssign> {
    const t = parseAssignTarget(target);
    if (!t) throw new Error(tr('给谁：admin、default、type:<子代理类型>、name:<名字>'));
    if (id !== null) {
      const c = await this.get(id);
      if (!c) throw new Error(tr('没有 id 为 {id} 的角色', { id }));
      if (c.draft) throw new Error(tr('{id} 还是草稿，先保存再指定', { id }));
    }
    const a: CafeAssign = JSON.parse(JSON.stringify(this.assignStore.get() ?? {}));
    const set = (m: Record<string, string> | undefined, k: string) => {
      const out = { ...(m ?? {}) };
      if (id === null) delete out[k]; else out[k] = id;
      return out;
    };
    if (t === 'admin' || t === 'default') { if (id === null) delete a[t]; else a[t] = id; }
    else if (t.startsWith('type:')) a.byType = set(a.byType, t.slice(5));
    else a.byName = set(a.byName, t.slice(5));
    await this.assignStore.set(a);
    this.emit('changed');
    return a;
  }
}

const KINDS = new Set(['characters.list', 'characters.save', 'characters.delete', 'characters.assign']);
export function isCharactersRequest(req: { kind: string }): req is CharactersRequest { return KINDS.has(req.kind); }

/** `readOnly`: a remote-access / paired-device / other-machine connection — it may look, not change. */
export async function handleCharacters(s: CharacterService, req: CharactersRequest, readOnly: boolean): Promise<unknown> {
  if (req.kind !== 'characters.list' && readOnly) throw new Error(tr('只有本机的窗口才能改角色'));
  switch (req.kind) {
    case 'characters.list': return s.listWithAssign();
    case 'characters.save': return s.save(req.character, req.draft === true);
    case 'characters.delete': return { ok: await s.remove(req.id) };
    case 'characters.assign': return s.assign(req.id, req.target);
  }
}
