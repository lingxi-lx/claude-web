// The connector directory's words and filtering (structure round 2, spec §4). Pure — Connectors.tsx draws it.
import type { McpHealth } from '@shared';
import { tr } from '@/i18n';

/** A configured server as `config.mcp` lists it (`claude mcp list`: name, target, a status line). */
export interface Configured { name: string; target?: string; status?: string }

export interface ConnectorState { tone: 'ok' | 'warn' | 'err' | ''; text: string }

/**
 * One line on a connected entry. A health check just run wins (it asked each server); otherwise the status line the
 * CLI printed, read for its three outcomes. A failure keeps the CLI's own words: they say what failed.
 */
export function connectorStatus(s: Configured, health?: McpHealth): ConnectorState {
  if (health) {
    if (health.status === 'connected') return { tone: 'ok', text: tr('已连接') };
    if (health.status === 'needs-auth') return { tone: 'warn', text: tr('要登录：在对话里输入 /mcp') };
    if (health.status === 'failed') return { tone: 'err', text: health.detail ? tr('连不上：{detail}', { detail: health.detail }) : tr('连不上') };
    return { tone: '', text: health.detail || tr('已添加') };
  }
  const raw = (s.status ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  if (/connected/i.test(raw) && !/not|fail/i.test(raw)) return { tone: 'ok', text: tr('已连接') };
  if (/auth/i.test(raw)) return { tone: 'warn', text: tr('要登录：在对话里输入 /mcp') };
  if (/fail|error|refus|timed? ?out/i.test(raw)) return { tone: 'err', text: tr('连不上：{raw}', { raw }) + slowRunnerHint(s.target) };
  return { tone: '', text: raw || tr('已添加') };
}

/**
 * `npx` / `uvx` look the package up online on every start (13–50 s measured on a Windows box with a warm cache), and
 * the CLI's connect timeout can run out first: a failure there may just be slow, so say so next to it.
 */
function slowRunnerHint(target?: string): string {
  const cmd = (target ?? '').trim().split(/\s+/)[0] ?? '';
  return downloadsOnFirstStart({ command: cmd }) ? tr('（用 {cmd} 启动的第一次要下载、之后也可能慢，过一会儿再点「检查连接」）', { cmd }) : '';
}

/** What adding an entry will ask for, as a small tag next to its name: a login in the browser, or keys to paste. */
export function connectorNeeds(c: { oauth?: boolean; env?: string[] }): { label: string; title: string } | null {
  if (c.oauth) return { label: tr('要登录'), title: tr('第一次用的时候，在对话里输入 /mcp，然后在浏览器里登录这个服务') };
  if (c.env?.length) return { label: tr('要密钥'), title: tr('添加时要填：{env}', { env: c.env.join('、') }) };
  return null;
}

/**
 * An entry launched by a package runner (`npx …`, `uvx …`) downloads its package on first start. Adding one waits for
 * that (the server runs it once, at most 2 minutes — server/src/config/mcp-warm.ts), so the page says why it is slow.
 * Same runner list as the server's.
 */
export function downloadsOnFirstStart(json: Record<string, unknown>): boolean {
  if (json.type && json.type !== 'stdio') return false;
  const cmd = typeof json.command === 'string' ? json.command : '';
  const base = cmd.replace(/\\/g, '/').split('/').pop()!.replace(/\.(cmd|exe|bat|ps1)$/i, '').toLowerCase();
  return ['npx', 'pnpx', 'bunx', 'uvx'].includes(base);
}

/** The toast once 添加 is done: the OAuth hint, or — when the first download did not finish in time — what to expect. */
export function addedMessage(name: string, o: { oauth?: boolean; warm?: { ok: boolean; timedOut?: boolean } }): string {
  if (o.warm?.timedOut) return tr('已添加 {name}。第一次下载还没完成，暂时可能显示连不上；过一两分钟点「检查连接」再看', { name });
  return tr('已添加 {name}{v}', { name, v: o.oauth ? tr('。第一次用的时候，在对话里输入 /mcp 完成登录') : '' });
}

/** By category (「全部」 = every one) and by what was typed: every word must be in the name, the line or the id. */
export function filterCatalog<T extends { id: string; name: string; desc: string; cat: string }>(items: readonly T[], o: { cat: string; query: string }): T[] {
  const words = o.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((c) => {
    if (o.cat !== tr('全部') && c.cat !== o.cat) return false;
    const hay = `${c.name} ${c.desc} ${c.id}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
