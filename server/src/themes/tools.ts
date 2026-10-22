// The `theme_*` tools of the `web` MCP server (tool-defs.ts), and the `ascii` plugin that carries the ascii-theme
// skill (written next to the cafe one: characters/tools.ts). Never throws: a failure is a result the model reads.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from '../files/service.js';
import { parsePack } from './core/index.js';
import { BUILTIN_THEMES, SKILL_MD } from './skill-text.js';
import type { ThemeService, ThemeSource } from './service.js';
import { tr } from '../i18n/index.js';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' };
export interface ThemeToolResult { content: Content[]; isError?: boolean }
const text = (t: string, isError = false): ThemeToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

export interface ThemeToolDeps {
  svc: ThemeService;
  /** the `ui.theme` setting, and setting it (theme_apply) */
  getTheme: () => unknown;
  setTheme: (v: string) => Promise<void>;
}

export function skillBody(): string {
  return SKILL_MD.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body.replace(/```/g, '`\u200b``')}\n\`\`\``;
function show(id: string, s: { json: string; backdrop?: string; css?: string }, kind: string): string {
  return [`## ${id}（${kind}）`, '### theme.json', fence('json', s.json), '### backdrop.js', fence('js', s.backdrop ?? ''), ...(s.css ? ['### theme.css', fence('css', s.css)] : [])].join('\n\n');
}
const nameOf = (json: string) => { try { const j = JSON.parse(json); return `${j?.name?.zh ?? ''} / ${j?.name?.en ?? ''}`; } catch { return ''; } };

export async function themeTool(d: ThemeToolDeps, name: string, args: Record<string, unknown>): Promise<ThemeToolResult> {
  const idArg = () => (typeof args.id === 'string' ? args.id.trim() : '');
  try {
    switch (name) {
      case 'theme_guide': {
        const ex = typeof args.example === 'string' && BUILTIN_THEMES[args.example] ? args.example : 'phosphor';
        return text(`${skillBody()}\n\n# 范例：内置主题「${ex}」\n\n${show(ex, BUILTIN_THEMES[ex], tr('内置'))}`);
      }
      case 'theme_draft': {
        if (typeof args.backdrop !== 'string') return text(tr('theme_draft 需要 backdrop（backdrop.js 的源码，字符串）'), true);
        if (args.css !== undefined && typeof args.css !== 'string') return text(tr('css 要是字符串'), true);
        const json = typeof args.json === 'string' ? (() => { try { return JSON.parse(args.json as string); } catch { return args.json; } })() : args.json;
        const jid = (json as any)?.id;
        if (typeof jid === 'string' && BUILTIN_THEMES[jid]) return text(tr('「{id}」是内置主题的 id，换一个新 id 再提交。', { id: jid }), true);
        const r = d.svc.saveDraft({ json, backdrop: args.backdrop, css: args.css as string | undefined });
        if (!r.pack || !r.source) return text(tr('没有存，主题有这些问题：\n- {errors}', { errors: r.errors.join('\n- ') }), true);
        const problems = r.errors.length ? tr('\n\n还要改的地方：\n- {errors}', { errors: r.errors.join('\n- ') }) : tr('\n\n格式、对比度、CSS、代码检查都通过了。');
        const trial = await d.svc.trial(r.source);
        if (!trial) {
          return text(tr('草稿已存：{name}（{id}）。{problems}\n\n没有试跑：现在没有打开着的 Claude Web 窗口来跑它，所以没有截图，也没测速度。用户打开窗口后再提交一次就能看到。', { name: `${r.pack.name.zh} / ${r.pack.name.en}`, id: r.pack.id, problems }));
        }
        const speed = trial.avgMs !== undefined ? tr('背景每帧平均 {avg} ms，最慢 {max} ms（超过 50 ms 持续 2 秒会被换下）。', { avg: trial.avgMs.toFixed(1), max: (trial.maxMs ?? trial.avgMs).toFixed(1) }) : '';
        const ran = trial.errors.length ? tr('\n\n试跑时出的问题：\n- {errors}', { errors: trial.errors.join('\n- ') }) : '';
        const content: Content[] = [{ type: 'text', text: tr('草稿已存：{name}（{id}）。{problems}{ran}\n\n试跑：{speed}{note}下面是截图：上面是新对话页的背景跑了 3 秒的样子（中间那块是页面文字的位置，背景应该在那里变淡），下面是 16 个过程动画。看看字清不清楚、背景是不是太满、动画宽度齐不齐，满意了用 theme_save。', { name: `${r.pack.name.zh} / ${r.pack.name.en}`, id: r.pack.id, problems, ran, speed, note: trial.note ? `${trial.note} ` : '' }) }];
        if (trial.png) content.push({ type: 'image', data: trial.png, mimeType: 'image/png' });
        return { content };
      }
      case 'theme_get': {
        const id = idArg();
        if (BUILTIN_THEMES[id]) return text(show(id, BUILTIN_THEMES[id], tr('内置，只读：改的话换个新 id 提交')));
        const s = d.svc.get(id);
        return s ? text(show(id, s, s.draft ? tr('草稿') : tr('已保存'))) : text(tr('没有这个主题：{id}（theme_list 看有哪些）', { id }), true);
      }
      case 'theme_save': {
        const s = d.svc.publish(idArg());
        return text(tr('已保存：{name}（{id}）。它出现在设置 → 外观的字符画主题里了；要现在换上就用 theme_apply。', { name: nameOf(s.json), id: s.id }));
      }
      case 'theme_apply': {
        const id = idArg();
        const s = BUILTIN_THEMES[id] ? null : d.svc.list().find((t) => t.id === id);
        if (!BUILTIN_THEMES[id] && !s) return text(tr('没有这个已保存的主题：{id}（草稿要先 theme_save）', { id }), true);
        await d.setTheme(`ascii:${id}`);
        return text(tr('已换上「{id}」。', { id }));
      }
      case 'theme_list': {
        const cur = String(d.getTheme() ?? '');
        const line = (id: string, json: string, kind: string) => `- ${id} · ${nameOf(json)} · ${kind}${cur === `ascii:${id}` ? tr(' · 正在用') : ''}`;
        const rows = [
          ...Object.entries(BUILTIN_THEMES).map(([id, s]) => line(id, s.json, tr('内置'))),
          ...d.svc.list(true).map((s: ThemeSource) => line(s.id, s.json, s.draft ? tr('草稿') : tr('已保存'))),
        ];
        return text(rows.join('\n'));
      }
      case 'theme_delete': {
        const id = idArg();
        if (BUILTIN_THEMES[id]) return text(tr('内置主题不能删。'), true);
        if (!d.svc.remove(id)) return text(tr('没有这个主题：{id}', { id }), true);
        if (String(d.getTheme() ?? '') === `ascii:${id}`) await d.setTheme('system');
        return text(tr('已删除「{id}」。', { id }));
      }
    }
    return text(tr('没有这个工具：{name}', { name }), true);
  } catch (e: any) {
    return text(String(e?.message ?? e).slice(0, 2000), true);
  }
}

/** A saved theme parses into a pack the web app can put on (the same check the web app makes) — for the list it gets. */
export function usable(s: ThemeSource): boolean {
  try { return !!parsePack(JSON.parse(s.json), { backdrop: s.backdrop, css: s.css }).pack; } catch { return false; }
}

/**
 * The `ascii` plugin (`plugins: [{type: 'local', path}]`): the ascii-theme skill, written to
 * `<dataDir>/runtime/plugins/ascii/` when its content changes. Null when it cannot be written.
 */
let written: string | null | undefined;
export function asciiPluginDir(root = path.join(dataDir(), 'runtime', 'plugins')): string | null {
  if (written !== undefined) return written;
  const dir = path.join(root, 'ascii');
  try {
    const files: [string, string][] = [
      [path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'ascii', version: '1.0.0', description: 'Claude Web character (ASCII-art) themes: describe one, get one.' }, null, 2)],
      [path.join(dir, 'skills', 'ascii-theme', 'SKILL.md'), SKILL_MD],
    ];
    for (const [f, body] of files) {
      let same = false;
      try { same = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') === crypto.createHash('sha256').update(body).digest('hex'); } catch { /* not there yet */ }
      if (same) continue;
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(`${f}.tmp`, body);
      fs.renameSync(`${f}.tmp`, f);
    }
    written = dir;
  } catch (e) {
    console.warn(`[themes] could not write the ascii plugin: ${(e as Error).message}`);
    written = null;
  }
  return written;
}
export function resetAsciiPlugin() { written = undefined; }
