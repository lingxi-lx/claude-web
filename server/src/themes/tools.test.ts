import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeService } from './service.js';
import { asciiPluginDir, resetAsciiPlugin, themeTool, usable } from './tools.js';
import { BUILTIN_THEMES, SKILL_MD } from './skill-text.js';
import { THEME_TOOLS } from './tool-defs.js';
import { THEME_FREE_TOOLS } from '../web/launcher.js';
import { TOOLS } from '../web/mcp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const phosphor = BUILTIN_THEMES.phosphor;
const mine = (id = 'mine') => ({ ...JSON.parse(phosphor.json), id, name: { zh: '我的', en: 'Mine' } });

let dir: string;
let svc: ThemeService;
let theme: unknown;
const deps = () => ({ svc, getTheme: () => theme, setTheme: async (v: string) => { theme = v; } });
const call = (name: string, args: Record<string, unknown> = {}) => themeTool(deps(), name, args);
const textOf = (r: { content: { type: string; text?: string }[] }) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-themes-'));
  svc = new ThemeService(dir);
  theme = 'dark';
});
afterEach(() => { svc.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('theme tools', () => {
  it('the skill text matches its sources (run scripts/gen-skill-text.mjs after editing them)', () => {
    expect(SKILL_MD).toBe(fs.readFileSync(path.join(root, 'server/src/themes/ascii-theme.md'), 'utf8').replace(/\r\n/g, '\n'));
    const ids = fs.readdirSync(path.join(root, 'web/src/themes/builtin')).filter((d) => fs.existsSync(path.join(root, 'web/src/themes/builtin', d, 'theme.json'))).sort();
    expect(Object.keys(BUILTIN_THEMES).sort()).toEqual(ids);
    for (const id of ids) expect(BUILTIN_THEMES[id].json, id).toBe(fs.readFileSync(path.join(root, 'web/src/themes/builtin', id, 'theme.json'), 'utf8').replace(/\r\n/g, '\n'));
  });
  it('every theme tool is listed by the MCP server; the free ones are real names', () => {
    for (const t of THEME_TOOLS) expect(TOOLS.some((x) => x.name === t.name)).toBe(true);
    for (const f of THEME_FREE_TOOLS) expect(THEME_TOOLS.some((t) => `mcp__web__${t.name}` === f)).toBe(true);
    expect(THEME_FREE_TOOLS).not.toContain('mcp__web__theme_apply');
    expect(THEME_FREE_TOOLS).not.toContain('mcp__web__theme_delete');
  });
  it('guide: the skill and a built-in example', async () => {
    const t = textOf(await call('theme_guide'));
    expect(t).toMatch(/16 个过程/);
    expect(t).toMatch(/内置主题「phosphor」/);
  });
  it('draft → no window: kept, says it did not run; problems listed; a built-in id refused', async () => {
    const r = await call('theme_draft', { json: mine(), backdrop: phosphor.backdrop, css: phosphor.css });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toMatch(/没有试跑/);
    expect(svc.get('mine')?.draft).toBe(true);
    const bad = await call('theme_draft', { json: { id: 'Bad' }, backdrop: 'x' });
    expect(bad.isError).toBe(true);
    const builtinId = await call('theme_draft', { json: { ...mine(), id: 'phosphor' }, backdrop: phosphor.backdrop });
    expect(textOf(builtinId)).toMatch(/内置主题的 id/);
    const low = await call('theme_draft', { json: { ...mine('low'), colors: { ...mine().colors, 'fg-3': mine().colors.bg } }, backdrop: phosphor.backdrop });
    expect(textOf(low)).toMatch(/fg-3 在 bg 上对比度/);
  });
  it('draft with a window: the trial answer (picture, speed, errors) comes back to the model', async () => {
    const key = {};
    svc.setHost(key, true, (req) => setTimeout(() => svc.trialResult(key, req.id, { png: 'iVBOR', errors: ['frame threw'], avgMs: 3.2, maxMs: 9 }), 5));
    const r = await call('theme_draft', { json: mine(), backdrop: phosphor.backdrop });
    expect(r.content.some((c) => c.type === 'image')).toBe(true);
    expect(textOf(r)).toMatch(/3\.2 ms/);
    expect(textOf(r)).toMatch(/frame threw/);
  });
  it('a window that goes away mid-trial: the draft says it did not run', async () => {
    const key = {};
    svc.setHost(key, true, () => setTimeout(() => svc.dropConnection(key), 5));
    expect(textOf(await call('theme_draft', { json: mine(), backdrop: phosphor.backdrop }))).toMatch(/没有试跑/);
  });
  it('save → listed, usable, changed event; apply sets ui.theme; delete takes it back to the system theme', async () => {
    await call('theme_draft', { json: mine(), backdrop: phosphor.backdrop, css: phosphor.css });
    let changed = 0;
    svc.on('changed', () => changed++);
    expect(textOf(await call('theme_save', { id: 'mine' }))).toMatch(/已保存/);
    expect(svc.list().map((s) => s.id)).toEqual(['mine']);
    expect(usable(svc.list()[0])).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(changed).toBeGreaterThan(0);
    expect(textOf(await call('theme_list'))).toMatch(/mine · 我的 \/ Mine · 已保存/);
    await call('theme_apply', { id: 'mine' });
    expect(theme).toBe('ascii:mine');
    expect((await call('theme_apply', { id: 'nope' })).isError).toBe(true);
    expect(textOf(await call('theme_get', { id: 'mine' }))).toMatch(/theme\.json/);
    expect((await call('theme_delete', { id: 'phosphor' })).isError).toBe(true);
    await call('theme_delete', { id: 'mine' });
    expect(svc.list()).toEqual([]);
    expect(theme).toBe('system');
  });
  it('ids cannot reach outside the folder', async () => {
    expect((await call('theme_save', { id: '../x' })).isError).toBe(true);
    expect((await call('theme_get', { id: '..' })).isError).toBe(true);
  });
  it('the ascii plugin carries the skill', () => {
    resetAsciiPlugin();
    const d = asciiPluginDir(dir)!;
    expect(fs.readFileSync(path.join(d, 'skills', 'ascii-theme', 'SKILL.md'), 'utf8')).toBe(SKILL_MD);
    resetAsciiPlugin();
  });
});
