// The server's check of a theme draft (spec 2026-10-22 §5 「静态检查」): the pack's format, every process drawn, the
// contrast table, CSS that stays offline, and backdrop code that compiles. The code is compiled, never run: running a
// theme's code is the backdrop worker's job, in the page, without network (web/src/themes/backdrop-worker.ts).
import vm from 'node:vm';
import { PROCESSES, contrastProblems, parsePack, type ThemePack } from './core/index.js';

export const MAX_CODE = 256 * 1024;
export const MAX_TOTAL = 2 * 1024 * 1024;

export interface Draft { json: unknown; backdrop?: string; css?: string }

export function checkDraft(d: Draft): { pack?: ThemePack; errors: string[] } {
  const errors: string[] = [];
  const size = JSON.stringify(d.json ?? null).length + (d.backdrop?.length ?? 0) + (d.css?.length ?? 0);
  if (size > MAX_TOTAL) return { errors: [`整套主题 ${Math.round(size / 1024)} KB，最多 2048 KB`] };
  if ((d.backdrop?.length ?? 0) > MAX_CODE) errors.push(`backdrop.js ${Math.round(d.backdrop!.length / 1024)} KB，最多 256 KB`);
  const { pack, errors: packErrors } = parsePack(d.json, { backdrop: d.backdrop, css: d.css });
  errors.push(...packErrors);
  if (!pack) return { errors };
  for (const p of PROCESSES) if (!pack.processes[p] && !pack.broken[p]) errors.push(`processes 缺少「${p}」（会用默认动画代替）`);
  errors.push(...contrastProblems(pack.colors));
  if (!d.backdrop?.trim()) errors.push('缺少 backdrop.js（没有背景动画）');
  else {
    if (!/(^|[^\w$.])export\s+default\s+/.test(d.backdrop)) errors.push('backdrop.js 要 `export default { … }`');
    try {
      // the same rewrite the worker does, then only compiled
      new vm.Script(`(function () {"use strict";\n${d.backdrop.replace(/(^|[^\w$.])export\s+default\s+/, '$1return ')}\n})`, { filename: 'backdrop.js' });
    } catch (e: any) {
      errors.push(`backdrop.js 语法错误：${e?.message ?? e}`);
    }
    if (/(^|[^\w$.])import\s*[({'"*\w]/.test(d.backdrop)) errors.push('backdrop.js 不能 import（背景代码没有网络，也没有模块）');
  }
  return { pack, errors };
}
