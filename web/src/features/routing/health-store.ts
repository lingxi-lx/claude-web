// 来源健康: the last probe and the quota / 429 state of every provider source (channels.health.*). One request feeds
// every card; a card's probe updates just its own row.
import { create } from 'zustand';
import { ws } from '@/ws/client';
import type { SourceHealthStatus, SourceHealthView } from '@shared';

interface HealthState {
  byId: Record<string, SourceHealthView>;
  loadedAt: number;
  busy: Record<string, boolean>;
  load(): Promise<void>;
  probe(providerId: string, chat: boolean): Promise<SourceHealthView>;
}

let loading: Promise<void> | null = null;

export const useSourceHealth = create<HealthState>((set, get) => ({
  byId: {},
  loadedAt: 0,
  busy: {},
  load() {
    loading ??= ws.request<SourceHealthStatus>({ kind: 'channels.health.status' })
      .then((r) => set({ byId: Object.fromEntries(r.sources.map((s) => [s.providerId, s])), loadedAt: Date.now() }))
      .catch(() => { /* an older server: no health line */ })
      .finally(() => { loading = null; });
    return loading;
  },
  async probe(providerId, chat) {
    set({ busy: { ...get().busy, [providerId]: true } });
    try {
      const v = await ws.request<SourceHealthView>({ kind: 'channels.health.probe', providerId, chat });
      set({ byId: { ...get().byId, [providerId]: v } });
      return v;
    } finally {
      const { [providerId]: _, ...rest } = get().busy;
      set({ busy: rest });
    }
  },
}));
