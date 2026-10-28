// The model hub's own store: which page is in front, which pages have been mounted. Data still comes from the
// gateway store (`useGateway`) until the new sources / routing stores land; this page set is only the shell.
import { create } from 'zustand';
import { hideSheet, useStore } from '@/store';
import { closeOtherPages, registerPage } from '@/features/sections/pages';
import { markPageOpened } from '@/features/automation/state';
import { installGatewayEvents, useGateway } from '@/features/gateway/state';
import type { HubPageId } from './page';

interface HubState {
  open: boolean;
  page: HubPageId;
  /** mounted at least once: from then on only hidden */
  seen: HubPageId[];
}

export const useHub = create<HubState>(() => ({ open: false, page: 'overview', seen: [] }));

export function openHub(page?: HubPageId): boolean {
  closeOtherPages('gateway');
  if (!useHub.getState().open) markPageOpened();
  useHub.setState((s) => {
    const next = page ?? s.page;
    return { open: true, page: next, seen: s.seen.includes(next) ? s.seen : [...s.seen, next] };
  });
  if (useStore.getState().mobile) { useStore.setState({ sidebarOpen: false }); hideSheet(); }
  installGatewayEvents();
  void useGateway.getState().load().catch(() => {});
  return true;
}

export function showHubPage(page: HubPageId): void {
  useHub.setState((s) => ({ page, seen: s.seen.includes(page) ? s.seen : [...s.seen, page] }));
}

export function closeHub(): void {
  if (useHub.getState().open) useHub.setState({ open: false });
}

// The rail's gateway section now opens the hub; the old gateway page keeps its own store and tests but is no longer
// registered as the section.
registerPage('gateway', { isOpen: () => useHub.getState().open, close: closeHub, subscribe: (fn) => useHub.subscribe(fn) });
