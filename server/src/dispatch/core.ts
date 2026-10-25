// 派活 (stage F3): one task + a machine + a project, sent from the phone or an IM chat, run as a new conversation on the
// computer. Pure: the request's shape, last time's defaults, the IM command.
import { tr } from '../i18n/index.js';

export type DispatchFrom = 'phone' | 'im' | 'app';
export interface DispatchParams { prompt: string; peer?: string; workspaceId?: string; from: DispatchFrom }

export const MAX_DISPATCH = 20_000;
const FROM: DispatchFrom[] = ['phone', 'im', 'app'];

export function normDispatch(p: { prompt?: unknown; peer?: unknown; workspaceId?: unknown; from?: unknown }): DispatchParams {
  const prompt = typeof p.prompt === 'string' ? p.prompt.trim().slice(0, MAX_DISPATCH) : '';
  if (!prompt) throw new Error(tr('派活需要一句任务'));
  const peer = typeof p.peer === 'string' && p.peer.trim() ? p.peer.trim() : undefined;
  const workspaceId = typeof p.workspaceId === 'string' && p.workspaceId.trim() ? p.workspaceId.trim() : undefined;
  const from = FROM.includes(p.from as DispatchFrom) ? (p.from as DispatchFrom) : 'app';
  return { prompt, ...(peer ? { peer } : {}), ...(workspaceId ? { workspaceId } : {}), from };
}

/** 上次的 machine / project, each only if it still exists (a machine also has to be on). */
export function dispatchDefaults(last: unknown, workspaces: readonly { id: string }[], peers: readonly { id: string; enabled: boolean }[]): { peer?: string; workspaceId?: string } {
  if (!last || typeof last !== 'object') return {};
  const l = last as { peer?: unknown; workspaceId?: unknown };
  const out: { peer?: string; workspaceId?: string } = {};
  if (typeof l.workspaceId === 'string' && workspaces.some((w) => w.id === l.workspaceId)) out.workspaceId = l.workspaceId;
  if (typeof l.peer === 'string' && peers.some((p) => p.id === l.peer && p.enabled)) out.peer = l.peer;
  return out;
}

/** `/dispatch <task>` or `/派活 <task>`; `<项目名>: <task>` (either colon) picks the project by name. */
export function parseImDispatch(text: string, workspaces: readonly { id: string; name: string }[]): { prompt: string; workspaceId?: string } | null {
  const m = /^\/(?:dispatch|派活)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const rest = (m[1] ?? '').trim();
  if (!rest) return null;
  const pm = /^([^:：\n]{1,80})[:：]\s*([\s\S]+)$/.exec(rest);
  if (pm) {
    const name = pm[1].trim().toLowerCase();
    const w = workspaces.find((x) => String(x.name ?? '').trim().toLowerCase() === name);
    if (w) return { prompt: pm[2].trim(), workspaceId: w.id };
  }
  return { prompt: rest };
}
