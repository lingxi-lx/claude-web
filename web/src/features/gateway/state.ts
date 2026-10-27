// The 上游 page's own store (like the automation page's): whether it is in front, which filter / source / drawer,
// and the data every part reads. Data is fetched when the page opens and on the server's change events.
import { create } from 'zustand';
import { hideSheet, useStore } from '@/store';
import { closeOtherPages, registerPage } from '@/features/sections/pages';
import { markPageOpened } from '@/features/automation/state';
import { ws } from '@/ws/client';
import type {
  CatalogSummary, ChannelStatus, EngineId, EngineStatus, EngineStep, GatewayAuditLine, GatewayGroup, GatewayKeyGroup, GatewayKeyStatus, GatewayKeyView,
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
  /** channels.status `available`: the add-source catalog (incl. the enabled plugins' sources) */
  catalog: CatalogSummary[];
  /** engines.status: CLIProxyAPI / Magpie, installed or not */
  engines: EngineStatus[];
  /** what a long install / start is doing now (engines.changed with a step); cleared when it settles */
  engineStep: Partial<Record<EngineId, EngineStep>>;
  /** the last thing that went wrong with an engine, in words (a failed action or a stop nobody asked for) */
  engineError: Partial<Record<EngineId, string>>;
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
  /** only what the add-source wizard needs (catalog + engines): it opens without the page too */
  loadCatalog(): Promise<void>;
  loadEngines(): Promise<void>;
}

const EMPTY_CH: ChannelStatus = { sources: [], warnings: [] };
const EMPTY_EN: { engines: EngineStatus[] } = { engines: [] };

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
  catalog: [],
  engines: [],
  engineStep: {},
  engineError: {},
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
    const [up, keys, lan, logs, st, tk, ch, en] = await Promise.all([
      ws.request<UpstreamStatus>({ kind: 'upstreams.status' }),
      ws.request<GatewayKeyStatus>({ kind: 'gateway.keys.status' }),
      ws.request<GatewayLanStatus>({ kind: 'gateway.lan.status' }),
      ws.request<GatewayAuditLine[]>({ kind: 'gateway.audit.list', limit: 300 }),
      ws.request<GatewayStatus>({ kind: 'gateway.status' }),
      ws.request<{ tasks: MaintenanceTask[]; runs: MaintenanceRun[] }>({ kind: 'tasks.list' }),
      // a server without channels.* (an older peer) still shows the rest
      ws.request<ChannelStatus>({ kind: 'channels.status' }).catch(() => EMPTY_CH),
      ws.request<{ engines: EngineStatus[] }>({ kind: 'engines.status' }).catch(() => EMPTY_EN),
    ]);
    // every array is replaced as a whole, so selectors keep stable references between loads
    set({
      accounts: up.accounts, families: up.families, warnings: up.warnings ?? [], sidecars: up.sidecars ?? [], pools: up.groups,
      routeGroups: st.groups, keyGroups: keys.groups, keys: keys.keys, lan, status: st, logs, tasks: tk.tasks, runs: tk.runs,
      sources: ch.sources, sourceWarnings: ch.warnings, catalog: ch.available ?? [], engines: en.engines, loaded: true,
    });
  },
  async loadCatalog() {
    const [ch, en] = await Promise.all([
      ws.request<ChannelStatus>({ kind: 'channels.status' }).catch(() => EMPTY_CH),
      ws.request<{ engines: EngineStatus[] }>({ kind: 'engines.status' }).catch(() => EMPTY_EN),
    ]);
    set({ sources: ch.sources, sourceWarnings: ch.warnings, catalog: ch.available ?? [], engines: en.engines });
  },
  async loadEngines() {
    const en = await ws.request<{ engines: EngineStatus[] }>({ kind: 'engines.status' }).catch(() => EMPTY_EN);
    set({ engines: en.engines });
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
    // 托管程序: a step of a long action shows in words; a settled change re-reads the statuses (and the sources: a
    // started engine is a provider now); a stop nobody asked for is kept as the engine's error
    if (e.kind === 'engines.changed') {
      const g = useGateway.getState();
      if (e.step) useGateway.setState({ engineStep: { ...g.engineStep, [e.id]: e.step } });
      else {
        const { [e.id]: _, ...rest } = g.engineStep;
        useGateway.setState({ engineStep: rest, ...(e.crash ? { engineError: { ...g.engineError, [e.id]: e.crash } } : {}) });
        void g.loadEngines();
        if (g.open) reloadSoon(); else void g.loadCatalog().catch(() => {});
      }
    }
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
