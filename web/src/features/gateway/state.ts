// The 上游 page's own store (like the automation page's): whether it is in front, which filter / source / drawer,
// and the data every part reads. Data is fetched when the page opens and on the server's change events.
import { create } from 'zustand';
import { hideSheet, useStore } from '@/store';
import { closeOtherPages, registerPage } from '@/features/sections/pages';
import { markPageOpened } from '@/features/automation/state';
import { ws } from '@/ws/client';
import type {
  ChannelStatus, GatewayAuditLine, GatewayGroup, GatewayKeyGroup, GatewayKeyStatus, GatewayKeyView,
  GatewayLanStatus, GatewayStatus, MaintenanceRun, MaintenanceTask, SidecarStatus, SourceSummary,
  UpstreamAccountView, UpstreamGroup, UpstreamStatus,
} from '@shared';
import type { GatewayDrawer, SourceFilter } from './page';

interface GatewayState {
  open: boolean;
  /** opened at least once: the page is mounted from then on, only hidden */
  seen: boolean;
  filter: SourceFilter;
  query: string;
  /** the source whose detail is shown (a channels id, or ROUTING_ID); null = the dashboard */
  detail: string | null;
  /** the drawer over the page (共享 / 隐私 / 活动); drawers seen once stay mounted, only hidden */
  drawer: GatewayDrawer | null;
  seenDrawers: GatewayDrawer[];
  /** channels.status: every source, already sorted by the server */
  sources: SourceSummary[];
  sourceWarnings: string[];
  /** 账号池 (UpstreamGroup): what a gateway member can point at */
  pools: UpstreamGroup[];
  /** 网关组 (GatewayGroup): what keys are allowed to use */
  routeGroups: GatewayGroup[];
  accounts: UpstreamAccountView[];
  families: UpstreamStatus['families'];
  warnings: string[];
  sidecars: SidecarStatus[];
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

const EMPTY_CH: ChannelStatus = { sources: [], warnings: [] };

export const useGateway = create<GatewayState>((set) => ({
  open: false,
  seen: false,
  filter: 'all',
  query: '',
  detail: null,
  drawer: null,
  seenDrawers: [],
  sources: [],
  sourceWarnings: [],
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
    const [up, keys, lan, logs, st, tk, ch] = await Promise.all([
      ws.request<UpstreamStatus>({ kind: 'upstreams.status' }),
      ws.request<GatewayKeyStatus>({ kind: 'gateway.keys.status' }),
      ws.request<GatewayLanStatus>({ kind: 'gateway.lan.status' }),
      ws.request<GatewayAuditLine[]>({ kind: 'gateway.audit.list', limit: 300 }),
      ws.request<GatewayStatus>({ kind: 'gateway.status' }),
      ws.request<{ tasks: MaintenanceTask[]; runs: MaintenanceRun[] }>({ kind: 'tasks.list' }),
      // a server without channels.* (an older peer) still shows the rest
      ws.request<ChannelStatus>({ kind: 'channels.status' }).catch(() => EMPTY_CH),
    ]);
    // every array is replaced as a whole, so selectors keep stable references between loads
    set({
      accounts: up.accounts, families: up.families, warnings: up.warnings ?? [], sidecars: up.sidecars ?? [], pools: up.groups,
      routeGroups: st.groups, keyGroups: keys.groups, keys: keys.keys, lan, status: st, logs, tasks: tk.tasks, runs: tk.runs,
      sources: ch.sources, sourceWarnings: ch.warnings, loaded: true,
    });
  },
}));

const reloadSoon = () => { if (useGateway.getState().open) void useGateway.getState().load().catch(() => {}); };

let wired = false;
export function installGatewayEvents(): void {
  if (wired) return;
  wired = true;
  // providers live in the main store: a provider added / edited elsewhere is a source here
  let providers = useStore.getState().providers;
  useStore.subscribe((s) => { if (s.providers !== providers) { providers = s.providers; reloadSoon(); } });
  ws.on((e) => {
    if (e.kind === 'upstreams.changed' || e.kind === 'gateway.changed') reloadSoon();
    if (e.kind === 'gateway.log') useGateway.setState((s) => ({ logs: [...e.lines, ...s.logs].slice(0, 500) }));
  });
}

export interface GatewayTarget { source?: string; drawer?: GatewayDrawer; filter?: SourceFilter }

/** Show the 上游 page (on a source / drawer when asked). On a phone the two drawers get out of the way. */
export function openGateway(target: GatewayTarget = {}): boolean {
  closeOtherPages('gateway');
  if (!useGateway.getState().open) markPageOpened();
  useGateway.setState((s) => ({
    open: true,
    seen: true,
    ...(target.filter ? { filter: target.filter } : {}),
    ...(target.source !== undefined ? { detail: target.source } : {}),
    ...(target.drawer ? { drawer: target.drawer, seenDrawers: s.seenDrawers.includes(target.drawer) ? s.seenDrawers : [...s.seenDrawers, target.drawer] } : {}),
  }));
  if (useStore.getState().mobile) { useStore.setState({ sidebarOpen: false }); hideSheet(); }
  installGatewayEvents();
  void useGateway.getState().load().catch(() => {});
  return true;
}

export const setGatewayFilter = (filter: SourceFilter): void => useGateway.setState({ filter, detail: null });
export const setGatewayQuery = (query: string): void => useGateway.setState({ query });
export const showSource = (id: string | null): void => useGateway.setState({ detail: id });

export function showDrawer(d: GatewayDrawer | null): void {
  useGateway.setState((s) => ({ drawer: d, ...(d && !s.seenDrawers.includes(d) ? { seenDrawers: [...s.seenDrawers, d] } : {}) }));
}

/** Esc on the page: put away the innermost thing (drawer, then the detail). False = nothing was open: close the page. */
export function gatewayEscape(): boolean {
  const s = useGateway.getState();
  if (s.drawer) { showDrawer(null); return true; }
  if (s.detail) { showSource(null); return true; }
  return false;
}

export function closeGateway(): void {
  if (useGateway.getState().open) useGateway.setState({ open: false });
}

registerPage('gateway', { isOpen: () => useGateway.getState().open, close: closeGateway, subscribe: (fn) => useGateway.subscribe(fn) });
