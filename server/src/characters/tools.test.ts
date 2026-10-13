import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CharacterService } from './service.js';
import { cafePluginDir, characterTool, resetCafePlugin, skillBody } from './tools.js';
import { CHARACTER_TOOLS } from './tool-defs.js';
import { SKILL_MD } from './skill-text.js';
import { OCTOPUS, type CafeAssign } from './core/index.js';
import { TOOLS } from '../web/mcp.js';

const mine = () => {
  const c: any = JSON.parse(JSON.stringify(OCTOPUS));
  delete c.builtin;
  return { ...c, id: 'mimi', name: '咪咪' };
};

describe('character tools', () => {
  let dir: string;
  let assign: CafeAssign | undefined;
  let svc: CharacterService;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cw-chartools-'));
    assign = undefined;
    svc = new CharacterService(path.join(dir, 'characters'), { get: () => assign, set: (a) => { assign = a; } });
  });
  afterEach(() => fsp.rm(dir, { recursive: true, force: true }));

  it('the web MCP server lists them', () => {
    for (const t of CHARACTER_TOOLS) expect(TOOLS.some((x) => x.name === t.name)).toBe(true);
  });
  it('the skill text is the .md file (run scripts/gen-skill-text.mjs after editing it)', () => {
    const md = fs.readFileSync(path.join(import.meta.dirname, 'cafe-character.md'), 'utf8').replace(/\r\n/g, '\n');
    expect(SKILL_MD).toBe(md);
    expect(SKILL_MD.startsWith('---\nname: cafe-character\n')).toBe(true);
  });
  it('guide is the skill without its frontmatter', async () => {
    const r = await characterTool(svc, 'character_guide', {});
    expect(r.content[0]).toMatchObject({ type: 'text' });
    expect((r.content[0] as any).text).toBe(skillBody());
    expect(skillBody().startsWith('---')).toBe(false);
  });
  it('a bad draft says what is wrong; a good one answers with a picture and is kept as a draft', async () => {
    const bad = mine();
    bad.front[0] = '.';
    const r = await characterTool(svc, 'character_draft', { character: bad });
    expect(r.isError).toBe(true);
    expect((r.content[0] as any).text).toContain('front 第 1 行');
    const ok = await characterTool(svc, 'character_draft', { character: mine() });
    expect(ok.isError).toBeUndefined();
    expect(ok.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect((ok.content[1] as any).data.startsWith('iVBOR')).toBe(true);
    expect((await svc.get('mimi'))?.draft).toBe(true);
  });
  it('save, assign, list', async () => {
    await characterTool(svc, 'character_draft', { character: mine() });
    expect((await characterTool(svc, 'character_assign', { id: 'mimi', target: 'admin' })).isError).toBe(true); // still a draft
    expect((await characterTool(svc, 'character_save', { id: 'mimi' })).isError).toBeUndefined();
    expect((await characterTool(svc, 'character_assign', { id: 'mimi', target: 'everyone' })).isError).toBe(true);
    expect((await characterTool(svc, 'character_assign', { id: 'mimi', target: 'type:Explore' })).isError).toBeUndefined();
    expect(assign).toEqual({ byType: { Explore: 'mimi' } });
    const list = (await characterTool(svc, 'character_list', {})).content[0] as any;
    expect(list.text).toContain('mimi · 咪咪 · 已保存 · 给了 type:Explore');
    expect(list.text).toContain('octopus · 小章鱼 · 内置');
    expect((await characterTool(svc, 'character_nope', {})).isError).toBe(true);
  });
  it('writes the plugin once, with the skill in it', () => {
    resetCafePlugin();
    const d = cafePluginDir(path.join(dir, 'plugins'))!;
    expect(fs.readFileSync(path.join(d, 'skills', 'cafe-character', 'SKILL.md'), 'utf8')).toBe(SKILL_MD);
    expect(JSON.parse(fs.readFileSync(path.join(d, '.claude-plugin', 'plugin.json'), 'utf8')).name).toBe('cafe');
    resetCafePlugin();
  });
});
