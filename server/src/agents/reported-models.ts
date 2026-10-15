import os from 'node:os';
import type { ReportedModel } from '../protocol.js';
import { modelLabel } from '../models/catalog.js';
import { JsonRpcProcess } from './jsonrpc.js';

/** Codex `model/list` entries → what the menus list: hidden ones left out, its own default marked. */
export function codexReported(data: unknown): ReportedModel[] {
  if (!Array.isArray(data)) return [];
  const out: ReportedModel[] = [];
  for (const m of data as any[]) {
    const value = typeof m?.model === 'string' && m.model ? m.model : typeof m?.id === 'string' ? m.id : '';
    if (!value || m.hidden || out.some((x) => x.value === value)) continue;
    out.push({
      value,
      displayName: typeof m.displayName === 'string' && m.displayName ? m.displayName : modelLabel('codex', value),
      ...(typeof m.description === 'string' && m.description ? { description: m.description } : {}),
      ...(m.isDefault ? { isDefault: true } : {}),
    });
  }
  return out;
}

/**
 * A Codex's own list for this account (it changes with the plan and with every release: 2026-10-15 this machine's
 * 0.162 offered gpt-6-luna, gpt-5.6-terra, gpt-5.6-luna — none of the catalog's 5.6 Sol / Pro): a short app-server,
 * initialize → model/list (all pages) → close. Starts no thread and runs nothing.
 */
export async function askCodexModels(launch: { command: string; args: string[]; env: Record<string, string> }, timeoutMs = 45_000): Promise<ReportedModel[]> {
  const rpc = new JsonRpcProcess(launch.command, launch.args, { cwd: os.homedir(), env: launch.env });
  const timer = setTimeout(() => rpc.kill(), timeoutMs);
  timer.unref?.();
  try {
    await rpc.request('initialize', { clientInfo: { name: 'claude-web', title: 'Claude Web', version: '0.1.0' }, capabilities: null }, timeoutMs);
    rpc.notify('initialized', {});
    const all: unknown[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const r: any = await rpc.request('model/list', cursor ? { cursor } : {}, timeoutMs);
      all.push(...(Array.isArray(r?.data) ? r.data : []));
      cursor = typeof r?.nextCursor === 'string' && r.nextCursor ? r.nextCursor : null;
      if (!cursor) break;
    }
    return codexReported(all);
  } finally {
    clearTimeout(timer);
    rpc.kill();
  }
}
