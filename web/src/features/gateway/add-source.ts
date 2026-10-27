// 添加来源: the one way to add a source (spec 2026-10-26 §2.3). A tiny store so the wizard can be opened from the
// 上游 page and from a conversation (the composer's 添加来源 line, the status strip); the host is mounted once in App.tsx.
import { create } from 'zustand';
import type { Provider } from '@shared';

export type AddStart = 'free' | 'login' | 'api';

/** Told what was added: the new profile for an API source, null for an account (it shows up in the model menu). */
export type OnAdded = (p: Provider | null) => void;

interface AddSourceState { open: boolean; start: AddStart | null; seq: number; onAdded: OnAdded | null }

export const useAddSource = create<AddSourceState>(() => ({ open: false, start: null, seq: 0, onAdded: null }));

/** Open the wizard (on one of the three big choices when `start` is given); `onAdded` hears each source added. */
export function openAddSource(start?: AddStart, onAdded?: OnAdded): void {
  useAddSource.setState((s) => ({ open: true, start: start ?? null, seq: s.seq + 1, onAdded: onAdded ?? null }));
}

export function closeAddSource(): void {
  useAddSource.setState({ open: false, onAdded: null });
}
