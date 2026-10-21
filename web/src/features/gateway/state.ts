// The gateway section's own store (like the automation page's): whether it is in front, which part, and the
// data every part reads. Data is fetched when the page opens and on the server's change events.
import { create } from 'zustand';
import { hideSheet, useStore } from '@/store';
import { closeOtherPages, registerPage } from '@/features/sections/pages';
import { markPageOpened } from '@/features/automation/state';
import { ws } from '@/ws/client';
import type {
  GatewayAuditLine, GatewayGroup, GatewayKeyGroup, GatewayKeyStatus, GatewayKeyView,
  GatewayLanStatus, GatewayStatus, MaintenanceRun, MaintenanceTask, SidecarStatus,
  UpstreamAccountView, UpstreamGroup, UpstreamStatus,
} from '@shared';
import { GATEWAY_TABS, isAdvancedTab, type GatewayTab } from './page';

interface GatewayState {
  open: boolean;
  tab: GatewayTab;
  /** show keys / logs / settings (account routing is part of ordinary use) */
  advanced: boolean;
  /** tabs shown at least once: mounted from then on, only hidden */
  seen: GatewayTab[];
  /** 账号池 (UpstreamGroup): what a gateway member can point at */
  pools: UpstreamGroup[];
  /** 网关组 (GatewayGroup): what keys are allowed to use */
  routeGroups: GatewayGroup[];
  accounts: UpstreamAccountView[];
  /** what each upstream family can do yet (Claude now; Gemini / WorkBuddy with their sidecars) */
  families: UpstreamStatus['families'];
  /** things to look at: a family with no healthy account, stopped accounts */
  warnings: string[];
  sidecars: SidecarStatus[];
  /** 任务中心: the periodic upkeep and its history */
  tasks: MaintenanceTask[];
  runs: MaintenanceRun[];
  keyGroups: GatewayKeyGroup[];
  keys: GatewayKeyView[];
  lan: GatewayLanStatus | null;
  status: GatewayStatus | null;
  logs: GatewayAuditLine[];
  loaded: boolean;
  load(): Promise<void>;
}

export const useGateway = create<GatewayState>((set) => ({
  open: false,
  tab: 'overview',
  advanced: false,
  seen: [],
  pools: [],
  routeGroups: [],
  accounts: [],
  families: [],
  warnings: [],
  sidecars: [],
  tasks: [],
  runs: [],
  keyGroups: [],
  keys: [],
  lan: null,
  status: null,
  logs: [],
  loaded: false,
  async load() {
    const [up, keys, lan, logs, st, tk] = await Promise.all([
      ws.request<UpstreamStatus>({ kind: 'upstreams.status' }),
      ws.request<GatewayKeyStatus>({ kind: 'gateway.keys.status' }),
      ws.request<GatewayLanStatus>({ kind: 'gateway.lan.status' }),
      ws.request<GatewayAuditLine[]>({ kind: 'gateway.audit.list', limit: 300 }),
      ws.request<GatewayStatus>({ kind: 'gateway.status' }),
      ws.request<{ tasks: MaintenanceTask[]; runs: MaintenanceRun[] }>({ kind: 'tasks.list' }),
    ]);
    // every array is replaced as a whole, so selectors keep stable references between loads
    set({ accounts: up.accounts, families: up.families, warnings: up.warnings ?? [], sidecars: up.sidecars ?? [], pools: up.groups, routeGroups: st.groups, keyGroups: keys.groups, keys: keys.keys, lan, status: st, logs, tasks: tk.tasks, runs: tk.runs, loaded: true });
  },
}));

let wired = false;
export function installGatewayEvents(): void {
  if (wired) return;
  wired = true;
  ws.on((e) => {
    if (e.kind === 'upstreams.changed' || e.kind === 'gateway.changed') {
      if (useGateway.getState().open) void useGateway.getState().load().catch(() => {});
    }
    if (e.kind === 'gateway.log') useGateway.setState((s) => ({ logs: [...e.lines, ...s.logs].slice(0, 500) }));
  });
}

const withSeen = (seen: GatewayTab[], t: GatewayTab): GatewayTab[] =>
  seen.includes(t) ? seen : GATEWAY_TABS.filter((x) => x.id === t || seen.includes(x.id)).map((x) => x.id);

/** Show the gateway page, on `tab` or the one shown last. On a phone the two drawers get out of the way. */
export function openGateway(tab?: GatewayTab): boolean {
  closeOtherPages('gateway');
  if (!useGateway.getState().open) markPageOpened();
  useGateway.setState((s) => {
    const t = tab ?? s.tab;
    return { open: true, tab: t, seen: withSeen(s.seen, t), ...(isAdvancedTab(t) ? { advanced: true } : {}) };
  });
  if (useStore.getState().mobile) { useStore.setState({ sidebarOpen: false }); hideSheet(); }
  installGatewayEvents();
  void useGateway.getState().load().catch(() => {});
  return true;
}

export function showGatewayTab(tab: GatewayTab): void {
  useGateway.setState((s) => ({ tab, seen: withSeen(s.seen, tab), ...(isAdvancedTab(tab) ? { advanced: true } : {}) }));
}

/** 高级设置: reveal routes / keys / logs / settings. Folding it while on one of them goes back to 概览. */
export function toggleGatewayAdvanced(): void {
  useGateway.setState((s) => {
    const advanced = !s.advanced;
    return { advanced, ...(!advanced && isAdvancedTab(s.tab) ? { tab: 'overview' as GatewayTab } : {}) };
  });
}

export function closeGateway(): void {
  if (useGateway.getState().open) useGateway.setState({ open: false });
}

registerPage('gateway', { isOpen: () => useGateway.getState().open, close: closeGateway, subscribe: (fn) => useGateway.subscribe(fn) });
