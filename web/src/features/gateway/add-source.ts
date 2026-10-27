// 添加来源: the one way to add a source (spec 2026-10-26 §2.3). A tiny store so the wizard can be opened from the
// 上游 page and, later, from a conversation's model menu; the host is mounted once in App.tsx.
import { create } from 'zustand';

export type AddStart = 'free' | 'login' | 'api';

interface AddSourceState { open: boolean; start: AddStart | null; seq: number }

export const useAddSource = create<AddSourceState>(() => ({ open: false, start: null, seq: 0 }));

/** Open the wizard (on one of the three big choices when `start` is given). */
export function openAddSource(start?: AddStart): void {
  useAddSource.setState((s) => ({ open: true, start: start ?? null, seq: s.seq + 1 }));
}

export function closeAddSource(): void {
  useAddSource.setState({ open: false });
}
