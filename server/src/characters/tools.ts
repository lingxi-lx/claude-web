import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from '../files/service.js';
import { parseAssignTarget, type CafeAssign, type CharacterDef } from './core/index.js';
import { previewPng } from './preview.js';
import type { CharacterService } from './service.js';
import { SKILL_MD } from './skill-text.js';

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' };
export interface CharacterToolResult { content: Content[]; isError?: boolean }

const text = (t: string, isError = false): CharacterToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

/** The skill's body, without its frontmatter. */
export function skillBody(): string {
  return SKILL_MD.replace(/^---\n[\s\S]*?\n---\n+/, '');
}

function holders(id: string, a: CafeAssign): string[] {
  const out: string[] = [];
  if (a.admin === id) out.push('网管');
  if (a.default === id) out.push('所有人（默认）');
  for (const [k, v] of Object.entries(a.byType ?? {})) if (v === id) out.push(`type:${k}`);
  for (const [k, v] of Object.entries(a.byName ?? {})) if (v === id) out.push(`name:${k}`);
  return out;
}

/** One `character_*` call of the `web` MCP server (tool-defs.ts). Never throws: a failure is a result the model reads. */
export async function characterTool(svc: CharacterService, name: string, args: Record<string, unknown>): Promise<CharacterToolResult> {
  try {
    switch (name) {
      case 'character_guide': return text(skillBody());
      case 'character_draft': {
        const r = await svc.save(args.character, true);
        if (!r.ok) return text(`没有存，角色有这些问题：\n- ${r.errors.join('\n- ')}`, true);
        return {
          content: [
            { type: 'text', text: `草稿已存：${r.def.name}（${r.def.id}）。下面是它的样子：正面、背面、走路 4 帧、敲键盘、吃泡面。对照用户要的再看一遍；用户在网吧的「角色库」里能看到它在动。满意了用 character_save。` },
            { type: 'image', data: previewPng(r.def).toString('base64'), mimeType: 'image/png' },
          ],
        };
      }
      case 'character_save': {
        const id = typeof args.id === 'string' ? args.id : '';
        const r = await svc.publish(id);
        return r.ok ? text(`已保存：${r.def.name}（${r.def.id}）。问问用户要给谁用（character_assign）。`) : text(r.errors.join('\n'), true);
      }
      case 'character_assign': {
        const id = args.id === null ? null : typeof args.id === 'string' ? args.id : '';
        const target = parseAssignTarget(args.target);
        if (!target) return text('target 要是 admin、default、type:<子代理类型>（比如 type:Explore）或 name:<名字>（比如 name:researcher）', true);
        if (id === '') return text('id 要是角色的 id（或 null 表示收回）', true);
        await svc.assign(id, target);
        return text(id === null ? `${target} 改回默认形象了。` : `已把 ${id} 给了 ${target}。`);
      }
      case 'character_list': {
        const { characters, assign } = await svc.listWithAssign();
        const line = (c: CharacterDef) => {
          const kind = c.builtin ? '内置' : c.draft ? '草稿' : '已保存';
          const who = holders(c.id, assign);
          return `- ${c.id} · ${c.name} · ${kind}${who.length ? ` · 给了 ${who.join('、')}` : ''}`;
        };
        return text(characters.map(line).join('\n'));
      }
    }
    return text(`没有这个工具：${name}`, true);
  } catch (e: any) {
    return text(String(e?.message ?? e).slice(0, 2000), true);
  }
}

/**
 * The `cafe` plugin for the Agent SDK (`plugins: [{type: 'local', path}]`): the cafe-character skill, written to
 * `<dataDir>/runtime/plugins/cafe/` (rewritten when its content changes — a packaged app's files are inside asar,
 * which the CLI cannot read). Null when it cannot be written: the conversation still has character_guide.
 */
let written: string | null | undefined;
export function cafePluginDir(root = path.join(dataDir(), 'runtime', 'plugins')): string | null {
  if (written !== undefined) return written;
  const dir = path.join(root, 'cafe');
  try {
    const files: [string, string][] = [
      [path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'cafe', version: '1.0.0', description: 'Claude Web 网吧: make pixel characters for the cafe view of sub-agents.' }, null, 2)],
      [path.join(dir, 'skills', 'cafe-character', 'SKILL.md'), SKILL_MD],
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
    console.warn(`[characters] could not write the cafe plugin: ${(e as Error).message}`);
    written = null;
  }
  return written;
}
/** Tests: forget what was written. */
export function resetCafePlugin() { written = undefined; }
